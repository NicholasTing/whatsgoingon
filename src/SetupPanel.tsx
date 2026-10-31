import { useRef, useState } from "react";
import instructions from "../docs/setup-prompt.md?raw";
import { readBoard } from "../shared/board.ts";
import type { Board } from "../shared/types.ts";

export function SetupPanel({ board }: { board: Board }) {
  const [name, setName] = useState(board.name);
  const [target, setTarget] = useState("local");
  const [message, setMessage] = useState("");
  const text = useRef<HTMLTextAreaElement>(null);
  const configuration = readBoard({
    ...board,
    name: name.trim() || board.name.trim() || "My status board",
    notifications: false,
  });
  const prompt = `${instructions.trim()}

## My setup preferences

- Setup target: ${target === "docker" ? "Docker setup. Start locally unless I supply a hosting destination." : "Local preview."}
- Audit target: the organisation repository open in this coding-agent session.
- Brand reference: use the supplied board colours unless I provide a public reference.
- Dashboard destination: a separate sibling directory unless I name an existing dashboard checkout.

## Starting board (extend with the agreed audit inventory)

\`\`\`json
${JSON.stringify(configuration, null, 2)}
\`\`\`
`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setMessage("Prompt copied. Paste it into your coding agent to begin.");
    } catch {
      text.current?.focus();
      text.current?.select();
      setMessage(
        "Copy was unavailable. The prompt is selected so you can copy it manually.",
      );
    }
  }

  return (
    <>
      <div className="dialog-body setup-body">
        <p>
          Run this prompt from your organisation's codebase. Your coding agent
          audits its dependencies, reviews the monitoring list with you, then
          starts a dashboard. Claude and Codex are included by default.
        </p>
        <div className="setup-fields">
          <label>
            Organisation or page name
            <input
              value={name}
              maxLength={80}
              placeholder={board.name}
              onChange={(event) => {
                setName(event.target.value);
                setMessage("");
              }}
            />
          </label>
          <div className="setup-field">
            <label htmlFor="setup-target">Setup target</label>
            <select
              id="setup-target"
              value={target}
              onChange={(event) => {
                setTarget(event.target.value);
                setMessage("");
              }}
            >
              <option value="local">Local preview first</option>
              <option value="docker">Docker with persistent storage</option>
            </select>
          </div>
        </div>
        <p className="small muted">
          Your current board supplies starting services, component selections,
          groups, and colours. The audit adds dependencies it finds. Custom
          monitor URLs are included, so review the prompt before sharing it.
        </p>
        <div className="setup-field">
          <label htmlFor="setup-prompt">Setup prompt</label>
          <textarea
            id="setup-prompt"
            ref={text}
            className="setup-prompt"
            value={prompt}
            readOnly
            rows={14}
            spellCheck={false}
          />
        </div>
        <p className="small muted">
          Open your organisation's repository in your coding agent before
          pasting. The agent needs access to both that codebase and
          whatsgoingon. The dashboard will run from a separate directory.
        </p>
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
      </div>
      <div className="dialog-footer">
        <span className="small muted">Your current board stays unchanged.</span>
        <button className="primary" onClick={copy}>
          Copy setup prompt
        </button>
      </div>
    </>
  );
}
