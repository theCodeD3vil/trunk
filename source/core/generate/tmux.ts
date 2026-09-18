/**
 * The shell bodies for the tmux workspace of one worktree: creating it when the
 * worktree starts, and taking it down in two steps when the worktree is removed.
 */
import {agentCommands, maximumAgents} from '../agents.js';
import {type Settings} from '../settings.js';
import {shellQuote} from './toml.js';

const branchTemplate = '{{ branch | sanitize }}';
const worktreeTemplate = '{{ worktree_path }}';

/** Editor window, optional Agents window, and a two-pane Terminal window. */
export function tmuxStartBody(settings: Settings): string {
	const defaultAgents = settings.agents.join(' ');
	const commandMappings = Object.entries(agentCommands)
		.filter(([id, command]) => id !== command)
		.map(
			([id, command]) =>
				`  [ "$a" = ${shellQuote(id)} ] && cmd=${shellQuote(command)}`,
		)
		.join('\n');
	// The window exists only when agents were chosen explicitly; an empty list
	// generates no agent code at all.
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

/**
 * `pre-remove`: asks every process running under the session's panes to exit,
 * waits briefly, then forces what is left. It runs before the worktree is
 * deleted, so it blocks and must never fail: a non-zero exit would cancel the
 * removal.
 */
export function tmuxStopBody(settings: Settings): string {
	return `command -v tmux >/dev/null 2>&1 || exit 0
P=${shellQuote(settings.prefix)}
B=${branchTemplate}
S="\${P}_$B"
tmux has-session -t "=$S" 2>/dev/null || exit 0

# Collect what runs under each pane. The panes' own shells are left for
# post-remove, because an interactive shell ignores SIGTERM.
PIDS=
collect_tree() {
  for child in $(pgrep -P "$1" 2>/dev/null); do
    PIDS="$PIDS $child"
    collect_tree "$child"
  done
}
for pane in $(tmux list-panes -s -t "=$S" -F '#{pane_id}'); do
  # The pane running this removal must survive it.
  [ "$pane" = "\${TMUX_PANE-}" ] && continue
  pane_pid=$(tmux display-message -p -t "$pane" '#{pane_pid}')
  [ -n "$pane_pid" ] && collect_tree "$pane_pid"
done
[ -n "$PIDS" ] || exit 0

kill -TERM $PIDS 2>/dev/null || true
n=0
while [ "$n" -lt 3 ]; do
  LEFT=
  for pid in $PIDS; do
    kill -0 "$pid" 2>/dev/null && LEFT="$LEFT $pid"
  done
  PIDS=$LEFT
  [ -n "$PIDS" ] || exit 0
  n=$((n + 1))
  sleep 1
done
kill -KILL $PIDS 2>/dev/null || true
exit 0`;
}

/**
 * `post-remove`: ends the session itself. Worktrunk runs this in the primary
 * worktree once the removed one is gone, so it relies only on the preserved
 * template variables, never on the removed path.
 */
export function tmuxKillBody(settings: Settings): string {
	return `command -v tmux >/dev/null 2>&1 || exit 0
P=${shellQuote(settings.prefix)}
B=${branchTemplate}
S="\${P}_$B"
tmux kill-session -t "=$S" 2>/dev/null || true`;
}
