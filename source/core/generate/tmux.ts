/** Creates and tears down the deterministic tmux workspace for one worktree. */
import {agentCommands, maximumAgents} from '../agents.js';
import {type Settings} from '../settings.js';
import {multilineCommand, shellQuote} from './toml.js';

const branchTemplate = '{{ branch | sanitize }}';
const worktreeTemplate = '{{ worktree_path }}';

export function generateTmuxPreStart(settings: Settings): string | undefined {
	if (!settings.tmux) {
		return undefined;
	}

	return `[[pre-start]]\ntmux = ${multilineCommand(tmuxStartBody(settings))}`;
}

export function tmuxStartBody(settings: Settings): string {
	const defaultAgents = settings.agents.join(' ');
	const commandMappings = Object.entries(agentCommands)
		.filter(([id, command]) => id !== command)
		.map(
			([id, command]) =>
				`  [ "$a" = ${shellQuote(id)} ] && cmd=${shellQuote(command)}`,
		)
		.join('\n');
	const agentWindow =
		settings.agents.length === 0
			? ''
			: `
AG_W=$(tmux new-window -P -F '#{window_id}' -t "=$S" -c "$W" -n Agents)
n=0
for a in \${WT_AGENTS-${defaultAgents}}; do
  [ "$n" -ge ${maximumAgents} ] && echo "only the first ${maximumAgents} agents are started" && break
  cmd=$a
${commandMappings}
  command -v "$cmd" >/dev/null 2>&1 || continue
  [ "$n" -gt 0 ] && tmux split-window -h -t "$AG_W" -c "$W"
  tmux send-keys -t "$AG_W" "$cmd" Enter
  n=$((n + 1))
done
[ "$n" -eq 2 ] && tmux select-layout -t "$AG_W" even-horizontal >/dev/null
[ "$n" -gt 2 ] && tmux select-layout -t "$AG_W" tiled >/dev/null`;

	return `command -v tmux >/dev/null 2>&1 || { echo "tmux not found; skipping session"; exit 0; }
[ "\${WT_TMUX-on}" = off ] && exit 0
P=${shellQuote(settings.prefix)}
B=${branchTemplate}
W=${worktreeTemplate}
S="\${P}_$B"

# Remove agent credentials before a new tmux server can inherit them.
for name in $(env | cut -d= -f1); do
  case $name in
    CLAUDE*|ANTHROPIC*|OPENCODE*|CODEX*|COPILOT*) unset "$name" ;;
  esac
done

if tmux has-session -t "=$S" 2>/dev/null; then
  session_path=$(tmux display-message -p -t "=$S" '#{session_path}')
  if [ "$session_path" = "$W" ]; then
    echo "tmux session $S already exists"
    exit 0
  fi
  tmux kill-session -t "=$S" 2>/dev/null || true
fi

if ! tmux new-session -d -s "$S" -c "$W" -n Editor; then
  echo "could not create tmux session $S"
  exit 0
fi
ED_W=$(tmux display-message -p -t "=$S:1" '#{window_id}')
editor=\${WT_EDITOR-\${EDITOR-nvim}}
if [ -n "$editor" ] && command -v "$editor" >/dev/null 2>&1; then
  tmux send-keys -t "$ED_W" "$editor" Enter
fi${agentWindow}
TERM_W=$(tmux new-window -P -F '#{window_id}' -t "=$S" -c "$W" -n Terminal)
tmux split-window -h -t "$TERM_W" -c "$W"
tmux select-window -t "$TERM_W"
printf 'tmux session %s ready; attach with: tmux attach -t =%s\\n' "$S" "$S"`;
}

export function tmuxRemoveBody(settings: Settings): string | undefined {
	if (!settings.tmux) {
		return undefined;
	}

	return `command -v tmux >/dev/null 2>&1 || exit 0
P=${shellQuote(settings.prefix)}
B=${branchTemplate}
S="\${P}_$B"
tmux has-session -t "=$S" 2>/dev/null || exit 0
PIDS=
collect_tree() {
  parent=$1
  for child in $(pgrep -P "$parent" 2>/dev/null); do
    collect_tree "$child"
  done
  PIDS="$PIDS $parent"
}
for pane in $(tmux list-panes -s -t "=$S" -F '#{pane_id}'); do
  [ "$pane" = "\${TMUX_PANE-}" ] && continue
  pane_pid=$(tmux display-message -p -t "$pane" '#{pane_pid}')
  [ -n "$pane_pid" ] && collect_tree "$pane_pid"
done
if [ -n "$PIDS" ]; then
  kill -TERM $PIDS 2>/dev/null || true
fi
# Keep this delayed command on one line: tmux drops run-shell commands containing newlines.
tmux run-shell -b -d 3 "if [ -n '$PIDS' ]; then kill -KILL $PIDS 2>/dev/null || true; fi; tmux kill-session -t '=$S' 2>/dev/null || true"`;
}
