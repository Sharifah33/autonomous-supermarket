import React, { useState } from 'react';
import { api, useApi } from '../api.js';
import { href } from '../router.js';
import { Loading, Page, Section, Table, money, num } from '../ui.jsx';

export default function RunsPage() {
  const [refresh, setRefresh] = useState(0);
  const state = useApi(`/runs?r=${refresh}`);
  const [seed, setSeed] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const start = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api('/runs', { seed: seed === '' ? undefined : Number(seed) });
      setMsg({ ok: true, text: `Created ${r.run_id} in ${(r.ms / 1000).toFixed(1)} s. It is stored separately; the Submitted Run is unchanged.`, runId: r.run_id });
      setRefresh((x) => x + 1);
      window.dispatchEvent(new Event('runs-changed'));
    } catch (e) {
      setMsg({ ok: false, text: `The run could not be created: ${e.message}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page
      title="Simulation runs"
      intro="Each run is one complete 60-day operating history. Its configuration is frozen when it starts and its history cannot be edited or deleted; changing the model means starting a new run."
    >
      <Section title="Start a new run" note="Runs the current model for 60 days with a new random draw. Leave the seed empty for a random one, or enter an integer to record a specific seed. Results will differ from the Submitted Run because demand is stochastic.">
        <div className="new-run">
          <label>
            Seed (optional)
            <input value={seed} inputMode="numeric" onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, ''))} placeholder="random" />
          </label>
          <button type="button" className="primary" onClick={start} disabled={busy}>
            {busy ? 'Running 60 days…' : 'Start new 60-day run'}
          </button>
        </div>
        {msg && (
          <p className={msg.ok ? 'ok-text' : 'error'}>
            {msg.text} {msg.runId && <a className="link" href={href(msg.runId, 'report')}>Open {msg.runId}</a>}
          </p>
        )}
      </Section>
      <Section title="All runs">
        <Loading state={state}>
          {(d) => (
            <Table
              columns={[
                { key: 'run_id', label: 'Run ID', render: (r) => <a className="link" href={href(r.run_id, 'report')}>{r.run_id}</a> },
                { key: 'is_submitted', label: 'Role', render: (r) => (r.is_submitted ? <b>Submitted Run</b> : r.label ?? 'Run') },
                { key: 'status', label: 'Status' },
                { key: 'seed', label: 'Seed', num: true },
                { key: 'customers', label: 'Customers', num: true, render: (r) => num(r.customers) },
                { key: 'revenue', label: 'Revenue', num: true, render: (r) => money(r.revenue) },
                { key: 'closing_cash', label: 'Closing cash', num: true, render: (r) => money(r.closing_cash) },
                { key: 'runtime_ms', label: 'Run time', num: true, render: (r) => `${(r.runtime_ms / 1000).toFixed(1)} s` },
                { key: 'created_at', label: 'Created', render: (r) => new Date(r.created_at).toLocaleString('en-AU') },
              ]}
              rows={d.runs}
            />
          )}
        </Loading>
      </Section>
    </Page>
  );
}
