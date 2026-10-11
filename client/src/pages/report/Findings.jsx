import React from 'react';
import { useApi } from '../../api.js';
import { L, Loading, Section, useRun } from '../../ui.jsx';

export default function Findings() {
  const { runId, run } = useRun();
  const state = useApi(`/runs/${runId}/report/findings`);
  return (
    <Loading state={state}>
      {(d) => (
        <>
          <Section
            title="Three findings and what to do next"
            note={`Each finding follows observation, evidence, diagnosis, business implication and recommendation. Figures are calculated live from ${runId}; select any evidence item to open the records behind it.${run && !run.is_submitted ? ' This is not the Submitted Run: the reasoning was written for the Submitted Run and may fit this run less well.' : ''}`}
          />
          {d.findings.map((f) => (
            <article className="finding" key={f.id} id={f.id}>
              <header>
                <span className="finding-id">{f.id}</span>
                <div>
                  <h2>{f.title}</h2>
                  <span className="finding-kind">{f.kind}</span>
                </div>
              </header>
              <ol className="chain">
                <li>
                  <h4>Observation</h4>
                  <p>{f.observation}</p>
                </li>
                <li>
                  <h4>Evidence</h4>
                  <dl className="evidence">
                    {f.evidence.map((e) => (
                      <div key={e.label}>
                        <dt>{e.label}</dt>
                        <dd>
                          {e.link ? (
                            <L page={e.link.page} arg={e.link.id ?? e.link.day ?? e.link.tab} query={e.link.type ? { type: e.link.type, product: e.link.product } : undefined}>
                              {e.value}
                            </L>
                          ) : (
                            e.value
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </li>
                <li>
                  <h4>Diagnosis</h4>
                  <p>{f.diagnosis}</p>
                </li>
                <li>
                  <h4>Business implication</h4>
                  <p>{f.implication}</p>
                </li>
                <li className="recommend">
                  <h4>Recommendation</h4>
                  <p>{f.recommendation}</p>
                </li>
              </ol>
              <p className="limitation">
                <b>Model limitation.</b> {f.limitation}
              </p>
            </article>
          ))}
        </>
      )}
    </Loading>
  );
}
