"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import styles from "@/app/components/common/option-picker.module.scss";

export type OptionPickerOption = {
  value: string;
  label: string;
};

function normalize(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

export function OptionPicker({
  value,
  options,
  onChange,
  placeholder,
  searchable = false,
  searchPlaceholder = "Search options",
}: {
  value: string;
  options: OptionPickerOption[];
  onChange: (value: string) => void;
  placeholder: string;
  searchable?: boolean;
  searchPlaceholder?: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) || null,
    [options, value]
  );

  const filteredOptions = useMemo(() => {
    const normalizedQuery = normalize(query);
    if (!normalizedQuery) return options;
    return options.filter((option) => normalize(option.label).includes(normalizedQuery));
  }, [options, query]);

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={`${styles.trigger} ${isOpen ? styles.triggerOpen : ""}`.trim()}
        onClick={() => {
          setIsOpen((current) => !current);
          if (!isOpen) setQuery("");
        }}
        aria-expanded={isOpen}
      >
        <span className={selectedOption ? styles.value : styles.placeholder}>
          {selectedOption?.label || placeholder}
        </span>
        <span className={styles.chevron} aria-hidden="true">▾</span>
      </button>

      {isOpen ? (
        <div className={styles.popover}>
          {searchable ? (
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className={styles.search}
              placeholder={searchPlaceholder}
              autoFocus
            />
          ) : null}

          <div className={styles.list}>
            {filteredOptions.map((option) => {
              const isActive = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  className={`${styles.option} ${isActive ? styles.optionActive : ""}`.trim()}
                  onClick={() => {
                    onChange(option.value);
                    setIsOpen(false);
                    setQuery("");
                  }}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
