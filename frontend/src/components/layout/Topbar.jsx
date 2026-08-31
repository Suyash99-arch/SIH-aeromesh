import Icon from "../ui/Icon";

export default function Topbar({ title, theme, setTheme, notice }) {
  const dark = theme === "dark";

  return (
    <header className="topbar">
      <div className="crumbs">
        <span>Mission Control</span>
        <i>/</i>
        <strong>{title}</strong>
      </div>

      <div className="top-actions">
        <span className="systems">
          <i /> Engine · Online
        </span>

        <button
          className="icon-button"
          aria-label={`Switch to ${dark ? "light" : "dark"} theme`}
          title="Toggle color theme"
          onClick={() => setTheme(dark ? "light" : "dark")}
        >
          <Icon name={dark ? "Sun" : "Moon"} size={17} />
        </button>

        <button
          className="icon-button notification"
          aria-label="Notifications"
          onClick={() => notice("No new operational alerts")}
        >
          <Icon name="Bell" size={17} />
          <b>3</b>
        </button>

        <button
          className="operator"
          onClick={() => notice("Operator profile opened")}
        >
          <span className="operator-avatar">AO</span>
          <section>
            <strong>Aero Operator</strong>
          </section>
          <Icon name="ChevronDown" size={14} />
        </button>
      </div>
    </header>
  );
}
