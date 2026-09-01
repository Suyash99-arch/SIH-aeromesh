import Icon from "../ui/Icon";

export default function Topbar({ title, notice }) {
  return (
    <header className="topbar">
      <div className="crumbs">
        <span>Mission Control</span>
        <i>/</i>
        <strong>{title}</strong>
      </div>

      <div className="top-actions">
        <span className="systems">
          <i /> ALL SYSTEMS OPERATIONAL
        </span>

        <button
          className="operator"
          onClick={() => notice("Operator profile opened")}
          type="button"
        >
          <span className="operator-avatar">KS</span>
          <span className="operator-name">Kumar Suyash</span>
        </button>
      </div>
    </header>
  );
}
