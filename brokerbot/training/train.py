import psutil
import builtins
# FORCE psutil into the system builtins so Unsloth can see it
builtins.psutil = psutil

import os
# Disable WandB explicitly to avoid the account prompt
os.environ["WANDB_DISABLED"] = "true"

from unsloth import FastLanguageModel
from unsloth.chat_templates import get_chat_template
import torch
from trl import SFTTrainer
from transformers import TrainingArguments
from datasets import load_dataset

# --- CONFIGURATION ---
max_seq_length = 512 
dtype = None 
load_in_4bit = True 

# 1. Load the Base Model
print("Loading Llama-3 Model...")
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name = "unsloth/llama-3-8b-Instruct-bnb-4bit",
    max_seq_length = max_seq_length,
    dtype = dtype,
    load_in_4bit = load_in_4bit,
)

# Fix for Llama-3 infinite generation loops
tokenizer.pad_token = tokenizer.eos_token
tokenizer.padding_side = "right" 

# 2. Add LoRA Adapters
model = FastLanguageModel.get_peft_model(
    model,
    r = 16, 
    target_modules = ["q_proj", "k_proj", "v_proj", "o_proj",
                      "gate_proj", "up_proj", "down_proj",],
    lora_alpha = 16,
    lora_dropout = 0, 
    bias = "none",    
    use_gradient_checkpointing = False, 
    random_state = 3407,
    use_rslora = False,
    loftq_config = None,
)

# 3. Format the Data
# Map your custom keys to Llama-3 standard
tokenizer = get_chat_template(
    tokenizer,
    chat_template = "llama-3",
    mapping = {"role": "role", "content": "content", "user": "user", "assistant": "assistant"}, 
)

def formatting_prompts_func(examples):
    # CHANGED: "conversations" -> "messages" to match your new JSONL format
    convos = examples["messages"]
    texts = [tokenizer.apply_chat_template(convo, tokenize = False, add_generation_prompt = False) for convo in convos]
    return { "text" : texts, }
def length_filter(ex):
    return len(tokenizer(ex["text"], add_special_tokens=False).input_ids) <= max_seq_length

print("Formatting Dataset...")
dataset = load_dataset("json", data_files="clean_conversations.jsonl", split="train")
dataset = dataset.map(formatting_prompts_func, batched = True)
dataset = dataset.filter(length_filter, num_proc=8)

# 4. Set Training Parameters
print("Configuring Trainer...")
trainer = SFTTrainer(
   model = model,
    tokenizer = tokenizer,
    train_dataset = dataset,
    dataset_text_field = "text",
    max_seq_length = max_seq_length,
    dataset_num_proc = 8,  # Increased to use more CPU cores for prep
    packing = True,        # <--- ENABLED: The massive speed hack
    neftune_noise_alpha = 5,
    args = TrainingArguments(
        per_device_train_batch_size = 32,  # Fits easily on 3090 with packing
        gradient_accumulation_steps = 1,  # Updates weights more often
        warmup_steps = 10,
        num_train_epochs = 2,
        learning_rate = 2e-4,
        fp16 = not torch.cuda.is_bf16_supported(),
        bf16 = torch.cuda.is_bf16_supported(),
        logging_steps = 25,
        optim = "adamw_8bit",
        weight_decay = 0.01,
        lr_scheduler_type = "linear",
        seed = 3407,
        output_dir = "outputs",
        report_to = "none",
	group_by_length = True
    ),
)

# 5. Train
print("Starting Training...")
trainer_stats = trainer.train()

# 6. Save
print("Saving Model...")
model.save_pretrained("lora_model")
tokenizer.save_pretrained("lora_model")
print("✅ DONE! Saved to 'lora_model/' directory.")
