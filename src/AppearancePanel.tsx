import { useState } from "react";
import {
  appearanceSchema,
  appearanceStyle,
  colourLabels,
  defaultAppearance,
  hexColour,
  presets,
} from "../shared/appearance.ts";
import type { Appearance, Colour } from "../shared/appearance.ts";
import { labels, symbols } from "../shared/types.ts";

export function AppearancePanel({
  appearance,
  save,
}: {
  appearance: Appearance;
  save: (value: Appearance) => void;
}) {
  const [draft, setDraft] = useState(appearance);
  const result = appearanceSchema.safeParse(draft);
  const statuses = [
    "operational",
    "degraded",
    "outage",
    "maintenance",
  ] as const;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (result.success) save(result.data);
      }}
    >
      <div className="dialog-body appearance-body">
        <p className="muted">
          Make this board yours. Colours are saved with your board, including
          exports and share links.
        </p>
        <fieldset className="preset-fieldset">
          <legend>Start with a preset</legend>
          <div className="preset-grid">
            {presets.map((preset) => (
              <button
                type="button"
                key={preset.name}
                className="preset"
                aria-pressed={
                  JSON.stringify(draft) === JSON.stringify(preset.appearance)
                }
                onClick={() => setDraft({ ...preset.appearance })}
              >
                <span className="preset-swatches" aria-hidden="true">
                  {(["accent", ...statuses] as Colour[]).map((key) => (
                    <i
                      key={key}
                      style={{ background: preset.appearance[key] }}
                    />
                  ))}
                </span>
                <strong>{preset.name}</strong>
                <span className="small muted">
                  {preset.appearance.mode === "dark"
                    ? "Dark canvas"
                    : "Light canvas"}
                </span>
              </button>
            ))}
          </div>
          <p className="small muted">
            Choosing a preset replaces the colours below.
          </p>
        </fieldset>
        <div className="appearance-layout">
          <section aria-labelledby="colours-title">
            <h3 id="colours-title">Your colours</h3>
            <div className="colour-fields">
              {(Object.keys(colourLabels) as Colour[]).map((key) => {
                const issue =
                  !result.success &&
                  result.error.issues.find((item) => item.path[0] === key);
                return (
                  <div key={key} className="colour-field">
                    <label htmlFor={`colour-${key}`}>{colourLabels[key]}</label>
                    <div className="colour-inputs">
                      <input
                        type="color"
                        aria-label={`${colourLabels[key]} colour picker`}
                        value={
                          hexColour.test(draft[key])
                            ? draft[key]
                            : appearance[key]
                        }
                        onChange={(event) =>
                          setDraft({ ...draft, [key]: event.target.value })
                        }
                      />
                      <input
                        id={`colour-${key}`}
                        aria-label={`${colourLabels[key]} hex colour`}
                        aria-invalid={!!issue}
                        aria-describedby={issue ? `error-${key}` : undefined}
                        spellCheck={false}
                        maxLength={7}
                        value={draft[key]}
                        onChange={(event) =>
                          setDraft({ ...draft, [key]: event.target.value })
                        }
                      />
                    </div>
                    {issue && (
                      <p className="error small" id={`error-${key}`}>
                        {issue.message}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
          <section
            className="appearance-preview"
            aria-labelledby="preview-title"
            style={appearanceStyle(draft)}
          >
            <div className="preview-heading">
              <span className="eyebrow" id="preview-title">
                Preview
              </span>
              <span className="small muted">
                {draft.mode === "dark" ? "Dark" : "Light"}
              </span>
            </div>
            <h3>Your status board</h3>
            <p className="small muted">A little clarity for your stack.</p>
            <div className="preview-service">
              <strong>Example service</strong>
              <div className="preview-bars" aria-hidden="true">
                {Array.from({ length: 30 }, (_, i) => (
                  <i
                    key={i}
                    style={{
                      background: `var(--${i === 19 ? "outage" : i === 12 ? "degraded" : "operational"})`,
                    }}
                  />
                ))}
              </div>
              <span className="small muted">Sample history</span>
            </div>
            <div className="preview-statuses">
              {statuses.map((state) => (
                <span className={`badge ${state}`} key={state}>
                  <span aria-hidden="true">{symbols[state]}</span>
                  {labels[state]}
                </span>
              ))}
            </div>
            <span className="primary preview-button">Accent preview</span>
          </section>
        </div>
        <p className="contrast-note small">
          Text and chart colours must have at least 4.5:1 contrast against the
          canvas. Status labels and symbols stay visible alongside colour.
        </p>
      </div>
      <div className="dialog-footer">
        <button
          type="button"
          className="text-button"
          onClick={() => setDraft({ ...defaultAppearance })}
        >
          Reset to default
        </button>
        <button type="submit" className="primary" disabled={!result.success}>
          Apply appearance
        </button>
      </div>
    </form>
  );
}
