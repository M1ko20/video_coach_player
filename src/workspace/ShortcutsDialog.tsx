import { Dialog } from '../ui/Dialog';
import { SHORTCUT_GROUPS } from './useShortcuts';

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts" className="dialog--shortcuts">
      <div className="shortcuts">
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group.title} className="shortcuts__group">
            <h3 className="shortcuts__heading">{group.title}</h3>
            <dl className="shortcuts__list">
              {group.items.map((item) => (
                <div key={item.action} className="shortcuts__row">
                  <dt>{item.action}</dt>
                  <dd>
                    {item.keys.map((key) => (
                      <kbd key={key}>{key}</kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <div className="dialog__actions">
        <button type="button" className="button button--primary" onClick={onClose} autoFocus>
          Done
        </button>
      </div>
    </Dialog>
  );
}
