import { createClient } from '@/lib/supabase/server'
import { updateAnalysisContext } from './actions'

export default async function SettingsPage() {
  const supabase = await createClient()

  const { data: setting } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'analysis_context')
    .single()

  const analysisContext = typeof setting?.value === 'string' ? setting.value : ''

  return (
    <div className="page">
      <h1>Settings</h1>

      <section className="panel">
        <h2>Analysis sector context</h2>
        <p className="dim">
          Sentence injected into the Claude Vision system prompt (Instagram screenshot analysis
          + email generation) to describe what kind of business UnFocus is pitching to. Change
          this to retarget the tool at a different industry — no deploy needed.
        </p>
        <form action={updateAnalysisContext} className="settings-form">
          <textarea
            name="analysis_context"
            rows={3}
            defaultValue={analysisContext}
            required
          />
          <button className="btn-primary" type="submit">
            Save
          </button>
        </form>
      </section>
    </div>
  )
}
