import requests

print("Uploading file... please wait...")
try:
    with open('vt_training_data_new.jsonl', 'rb') as f:
        response = requests.post(
            'https://catbox.moe/user/api.php',
            data={'reqtype': 'fileupload'},
            files={'fileToUpload': f}
        )
    print(f"\n✅ SUCCESS! Download URL: {response.text}")
except Exception as e:
    print(f"❌ Failed: {e}")