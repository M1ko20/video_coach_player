import { ChevronLeft, Keyboard } from 'lucide-react';
import { useState } from 'react';
import { StyleOptions } from '../annotations/StyleOptions';
import { useProjectStore } from '../project/projectStore';
import { SaveIndicator } from '../project/SaveIndicator';
import { goToLibrary, renameProject } from '../project/session';
import { RecordButton } from '../recording/RecordButton';
import { IconButton } from '../ui/IconButton';

/** Project name, editable in place. Commits on Enter or when focus leaves; Escape reverts. */
function ProjectNameInput({ name }: { name: string }) {
  const [value, setValue] = useState(name);

  const commit = () => {
    if (value.trim()) renameProject(value);
    else setValue(name);
  };

  return (
    <input
      className="project-name"
      aria-label="Analysis name"
      title="Rename this analysis"
      value={value}
      maxLength={120}
      spellCheck={false}
      size={Math.max(8, Math.min(40, value.length + 1))}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        else if (event.key === 'Escape') {
          setValue(name);
          // Blur once the reverted value has been applied, so it is not committed.
          const input = event.currentTarget;
          requestAnimationFrame(() => input.blur());
        }
      }}
    />
  );
}

function ProjectName() {
  const name = useProjectStore((state) => state.project?.name ?? '');
  // Keyed by the stored name so the field follows changes made elsewhere.
  return <ProjectNameInput key={name} name={name} />;
}

interface TopBarProps {
  onShowShortcuts: () => void;
  toolsDisabled: boolean;
}

export function TopBar({ onShowShortcuts, toolsDisabled }: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar__left">
        <IconButton label="All analyses" tooltipSide="bottom" onClick={goToLibrary}>
          <ChevronLeft size={20} />
        </IconButton>
        <ProjectName />
      </div>

      <div className="topbar__center">
        <StyleOptions disabled={toolsDisabled} />
      </div>

      <div className="topbar__right">
        <RecordButton disabled={toolsDisabled} />
        <SaveIndicator />
        <IconButton label="Keyboard shortcuts" shortcut="?" tooltipSide="left" onClick={onShowShortcuts}>
          <Keyboard size={18} />
        </IconButton>
      </div>
    </header>
  );
}
