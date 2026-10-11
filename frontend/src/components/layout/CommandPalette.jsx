import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Command, Compass, History, Layers3, Search, Workflow } from "lucide-react";
import { useUI } from "../../context/UIContext";
import "../../styles/command-palette.css";

const COMMANDS = [
  { id: "home", key: "home", icon: Compass },
  { id: "overview", key: "missionCommand", icon: Command },
  { id: "missions", key: "history", icon: History },
  { id: "pipeline", key: "pipeline", icon: Layers3 },
  { id: "workflow", key: "workflow", icon: Workflow },
];

export default function CommandPalette({ open, onClose, onNavigate, onHome, onWorkflow }) {
  const { t } = useUI();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const dialogRef = useRef(null);
  const inputRef = useRef(null);
  const previousFocusRef = useRef(null);

  const commands = useMemo(() => COMMANDS.map((command) => ({
    ...command,
    label: t(`commandPalette.${command.key}`),
  })), [t]);
  const filteredCommands = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return normalizedQuery
      ? commands.filter(({ label }) => label.toLocaleLowerCase().includes(normalizedQuery))
      : commands;
  }, [commands, query]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIndex(0);
      previousFocusRef.current?.focus?.();
      return undefined;
    }
    previousFocusRef.current = document.activeElement;
    inputRef.current?.focus();
    return undefined;
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  if (!open) return null;

  const selectCommand = (command) => {
    onClose();
    if (command.id === "home") onHome();
    else if (command.id === "workflow") onWorkflow();
    else onNavigate(command.id);
  };

  const handleKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => filteredCommands.length ? (index + 1) % filteredCommands.length : 0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => filteredCommands.length ? (index - 1 + filteredCommands.length) % filteredCommands.length : 0);
    } else if (event.key === "Enter" && filteredCommands[activeIndex]) {
      event.preventDefault();
      selectCommand(filteredCommands[activeIndex]);
    } else if (event.key === "Tab") {
      const focusable = [...(dialogRef.current?.querySelectorAll("input, button:not([disabled])") ?? [])]
        .filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !focusable.includes(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !focusable.includes(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  return (
    <div className="command-palette-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        ref={dialogRef}
        className="command-palette-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-palette-title"
        onKeyDown={handleKeyDown}
      >
        <div className="command-palette-search-row">
          <Search size={19} aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label={t("commandPalette.title")}
            aria-expanded="true"
            aria-controls="command-palette-options"
            aria-activedescendant={filteredCommands[activeIndex] ? `command-option-${filteredCommands[activeIndex].id}` : undefined}
            aria-autocomplete="list"
            placeholder={t("commandPalette.placeholder")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <kbd>ESC</kbd>
        </div>
        <div className="command-palette-heading">
          <h2 id="command-palette-title">{t("commandPalette.title")}</h2>
          <span>{t("commandPalette.suggestions")}</span>
        </div>
        <ul id="command-palette-options" className="command-palette-options" role="listbox" aria-label={t("commandPalette.suggestions")}>
          {filteredCommands.length ? filteredCommands.map((command, index) => {
            const Icon = command.icon;
            return (
              <li
                id={`command-option-${command.id}`}
                key={command.id}
                role="option"
                aria-selected={index === activeIndex}
                className={index === activeIndex ? "is-active" : ""}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectCommand(command)}
              >
                <div className="command-palette-option">
                  <span className="command-palette-icon"><Icon size={17} aria-hidden="true" /></span>
                  <span>{command.label}</span>
                  {index === activeIndex && <span className="command-palette-enter">↵</span>}
                </div>
              </li>
            );
          }) : <li className="command-palette-empty" role="status">{t("commandPalette.noResults")}</li>}
        </ul>
        <footer className="command-palette-footer" aria-label={`${t("commandPalette.navigateHint")}, ${t("commandPalette.selectHint")}`}>
          <span><kbd><ArrowUp size={12} /></kbd><kbd><ArrowDown size={12} /></kbd> {t("commandPalette.navigateHint")}</span>
          <span><kbd>↵</kbd> {t("commandPalette.selectHint")}</span>
        </footer>
      </section>
    </div>
  );
}
