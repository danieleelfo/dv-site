import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import bgImage from '../assets/Faro.jpeg'
import { useTranslation } from 'react-i18next'

const LELE_API_URL = 'https://api.danielevillanova.com'
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID

const TOKEN_STORAGE_KEY = 'leles_admin_id_token'
const ALLOWED_EMAILS = [
  'dannybydanny@hotmail.com',
  'salatinodenise@gmail.com',
]
const FORCED_ADMIN_CHAT_ID = 8733881519

const DEFAULT_PIPELINE = [
  'Planner',
  'Scientist',
  'Architect',
  'Builder',
  'Developer',
  'Critic',
  'Tester',
  'Reviewer',
  'Explorer',
  'Observer',
  'Outlaw',
  'Sheriff',
]

const DEFAULT_OVERRIDES = {
  Planner: 'deepseek-r1',
  Scientist: 'gemma4',
  Builder: 'qwen2.5',
  Critic: 'mistral',
  Observer: 'gemma4',
  Architect: 'qwen2.5',
  Developer: 'qwen2.5',
  Tester: 'deepseek-r1',
  Reviewer: 'gemma4',
  Sheriff: 'mistral',
  Outlaw: 'deepseek-r1',
  Explorer: 'gemma4',
}

const MODEL_OPTIONS = [
  'gemma4',
  'llama3',
  'qwen2.5',
  'deepseek-r1',
  'mistral',
]

const ROLE_ICONS = {
  Planner: '🧭',
  Scientist: '🧪',
  Architect: '🏗️',
  Builder: '🔨',
  Developer: '💻',
  Critic: '🔍',
  Tester: '🧪',
  Reviewer: '⚖️',
  Explorer: '🗺️',
  Observer: '👁️',
  Outlaw: '🏴‍☠️',
  Sheriff: '⭐',
}

function decodeJwtPayload(token) {
  try {
    const base64 = token
      .split('.')[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/')
    return JSON.parse(decodeURIComponent(escape(window.atob(base64))))
  } catch (e) {
    return null
  }
}

export default function EmergenceLab() {
  const { t } = useTranslation()
  const [idToken, setIdToken] = useState(() => {
    try {
      return window.sessionStorage.getItem(TOKEN_STORAGE_KEY) || null
    } catch (e) {
      return null
    }
  })

  const [profile, setProfile] = useState(() =>
    idToken ? decodeJwtPayload(idToken) : null
  )

  const [authError, setAuthError] = useState('')
  const [gsiReady, setGsiReady] = useState(false)

  const [worldId, setWorldId] = useState(8)
  const [numIterations, setNumIterations] = useState(3)
  const [judgeModel, setJudgeModel] = useState('qwen2.5')
  const [targetRole, setTargetRole] = useState('Outlaw')
  const [pipeline, setPipeline] = useState([...DEFAULT_PIPELINE])
  const [overrides, setOverrides] = useState({ ...DEFAULT_OVERRIDES })

  const [isLoading, setIsLoading] = useState(false)
  const [response, setResponse] = useState('')
  const [error, setError] = useState('')
  const [showConf, setShowConf] = useState(true)
  const [selectedPromptRole, setSelectedPromptRole] = useState(null)
  const [editingPrompt, setEditingPrompt] = useState(false)

  // Agents Lab: tab attiva ('emergence' | 'ns') e stato pannello NS.
  const [activeTab, setActiveTab] = useState('emergence')
  const [nsPrompts, setNsPrompts] = useState(null)
  const [nsSelected, setNsSelected] = useState(null)
  const [nsText, setNsText] = useState('')
  const [nsBusy, setNsBusy] = useState(false)
  const [nsStatus, setNsStatus] = useState('')
  const [nsError, setNsError] = useState('')

  const buttonRef = useRef(null)
  const chatIdRef = useRef(FORCED_ADMIN_CHAT_ID)

  const confObject = useMemo(() => {
    const pipeline_config = {
      pipeline: pipeline,
      model_strategy: 'override',
      model_overrides: Object.fromEntries(
        pipeline.map((role) => [role, overrides[role] || 'gemma4'])
      ),
    }

    return {
      world_id: Number(worldId) || 0,
      num_iterations: Number(numIterations) || 1,
      judge_model: judgeModel,
      target_role: targetRole,
      pipeline_config: JSON.stringify(pipeline_config),
    }
  }, [worldId, numIterations, judgeModel, targetRole, pipeline, overrides])

  const launchCommand = useMemo(() => {
    return (
      'exec airflow lancia emergence_flow conf: ' +
      JSON.stringify(confObject)
    )
  }, [confObject])

  useEffect(() => {
    if (!idToken) return

    const decoded = decodeJwtPayload(idToken)
    const email = decoded?.email?.toLowerCase()

    if (!email || !ALLOWED_EMAILS.includes(email)) {
      logout()
      setAuthError(t('ail.unauthorized'))
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (idToken) return

    let cancelled = false

    function tryInit() {
      if (cancelled) return

      if (!window.google?.accounts?.id) {
        setTimeout(tryInit, 150)
        return
      }

      if (!GOOGLE_CLIENT_ID) {
        setAuthError(
          t('ail.clientIdMissing')
        )
        return
      }

      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleCredentialResponse,
      })

      if (buttonRef.current) {
        window.google.accounts.id.renderButton(buttonRef.current, {
          type: 'standard',
          theme: 'filled_black',
          size: 'large',
          text: 'signin_with',
          shape: 'pill',
        })
      }

      setGsiReady(true)
    }

    tryInit()

    return () => {
      cancelled = true
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idToken])

  // Agents Lab: carica i prompt di Night Story la prima volta che
  // si apre il tab NS.
  useEffect(() => {
    if (activeTab === 'ns' && idToken && nsPrompts === null) {
      fetchNsPrompts()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, idToken])

  function handleCredentialResponse(credentialResponse) {
    const token = credentialResponse?.credential

    if (!token) {
      setAuthError(t('ail.loginFailed'))
      return
    }

    const decoded = decodeJwtPayload(token)
    const email = decoded?.email?.toLowerCase()

    if (!email || !ALLOWED_EMAILS.includes(email)) {
      setAuthError(t('ail.unauthorized'))

      try {
        window.google?.accounts?.id?.disableAutoSelect()
      } catch (e) {}

      return
    }

    setAuthError('')
    setProfile(decoded)
    setIdToken(token)

    try {
      window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token)
    } catch (e) {}
  }

  function logout() {
    setIdToken(null)
    setProfile(null)
    setResponse('')
    setError('')
    setSelectedPromptRole(null)
    setEditingPrompt(false)

    try {
      window.sessionStorage.removeItem(TOKEN_STORAGE_KEY)
      window.google?.accounts?.id?.disableAutoSelect()
    } catch (e) {}
  }

  function toggleRole(role) {
    setPipeline((prev) => {
      if (prev.includes(role)) {
        if (prev.length <= 1) return prev

        const next = prev.filter((r) => r !== role)

        if (targetRole === role) {
          setTargetRole(next[next.length - 1])
        }

        return next
      }

      return [
        ...DEFAULT_PIPELINE.filter(
          (r) => prev.includes(r) || r === role
        ),
      ]
    })
  }

  function setOverride(role, model) {
    setOverrides((prev) => ({ ...prev, [role]: model }))
  }

  function resetDefaults() {
    setWorldId(8)
    setNumIterations(3)
    setJudgeModel('qwen2.5')
    setTargetRole('Outlaw')
    setPipeline([...DEFAULT_PIPELINE])
    setOverrides({ ...DEFAULT_OVERRIDES })
  }

  async function sendCommand(prompt) {
    if (!idToken || !prompt.trim()) return

    setIsLoading(true)
    setResponse('')
    setError('')

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 310000)

    try {
      const res = await fetch(`${LELE_API_URL}/api/admin/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          prompt,
          language: 'en',
          chat_id: chatIdRef.current,
        }),
      })

      clearTimeout(timeoutId)

      if (res.status === 401 || res.status === 403) {
        logout()

        setError(
          res.status === 401
            ? t('ail.sessionExpired')
            : t('ail.unauthorizedShort')
        )

        return
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      }

      const data = await res.json()

      if (data.answer) {
        setResponse(data.answer)
      } else if (data.error) {
        setResponse(data.error)
      } else if (data.detail) {
        setResponse(
          typeof data.detail === 'string'
            ? data.detail
            : JSON.stringify(data.detail, null, 2)
        )
      } else {
        setResponse(t('ail.noAnswer'))
      }
    } catch (err) {
      clearTimeout(timeoutId)

      if (err.name === 'AbortError') {
        setError(t('ail.timeout'))
      } else {
        setError(err.message)
      }
    } finally {
      setIsLoading(false)
    }
  }

  async function handlePromptRole(role) {
    setSelectedPromptRole(role)
    setEditingPrompt(false)
    await sendCommand(`qe prompt ${role}`)
  }

  function handleEditPrompt() {
    if (!selectedPromptRole || !response || isLoading) return
    setEditingPrompt(true)
  }

  async function handleUpdatePrompt() {
    if (!selectedPromptRole || !response.trim() || isLoading) return
    const promptText = response
    await sendCommand(
      `Update emergence prompt ${selectedPromptRole} as "${promptText}"`
    )
    // sendCommand riceve la conferma di Leles:
    // ripristiniamo nel box il testo effettivamente editato
    setResponse(promptText)
    setEditingPrompt(false)
  }

  function handleLaunch(e) {
    e.preventDefault()
    setSelectedPromptRole(null)
    sendCommand(launchCommand)
  }

  // ==============================================================
  // NIGHT STORY PROMPTS (tab NS — Agents Lab)
  // Lista + edit + save via gateway /api/admin/ns-prompts.
  // ==============================================================

  async function fetchNsPrompts() {
    if (!idToken || nsBusy) return
    setNsBusy(true)
    setNsError('')
    setNsStatus('')
    try {
      const res = await fetch(`${LELE_API_URL}/api/admin/ns-prompts`, {
        headers: { Authorization: `Bearer ${idToken}` },
      })
      if (res.status === 401 || res.status === 403) {
        logout()
        setNsError(
          res.status === 401
            ? t('ail.sessionExpired')
            : t('ail.unauthorizedShort')
        )
        return
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      }
      const data = await res.json()
      setNsPrompts(Array.isArray(data.prompts) ? data.prompts : [])
    } catch (err) {
      setNsError(err.message)
    } finally {
      setNsBusy(false)
    }
  }

  function selectNsPrompt(name) {
    const item = (nsPrompts || []).find((p) => p.name === name)
    if (!item) return
    setNsSelected(name)
    setNsText(String(item.content || ''))
    setNsStatus('')
    setNsError('')
  }

  async function saveNsPrompt() {
    if (!idToken || !nsSelected || nsBusy) return
    setNsBusy(true)
    setNsError('')
    setNsStatus('Salvo su Night Story…')
    try {
      const res = await fetch(
        `${LELE_API_URL}/api/admin/ns-prompts/${encodeURIComponent(nsSelected)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ content: nsText }),
        }
      )
      if (res.status === 401 || res.status === 403) {
        logout()
        setNsError(
          res.status === 401
            ? t('ail.sessionExpired')
            : t('ail.unauthorizedShort')
        )
        return
      }
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(
          (data && data.detail) || `HTTP ${res.status}: ${res.statusText}`
        )
      }
      setNsPrompts((prev) =>
        (prev || []).map((p) =>
          p.name === nsSelected ? { ...p, content: nsText } : p
        )
      )
      setNsStatus(
        `✅ "${nsSelected}" salvato — Night Story userà il nuovo testo dalla prossima storia.`
      )
    } catch (err) {
      setNsStatus('')
      setNsError(err.message)
    } finally {
      setNsBusy(false)
    }
  }

  if (!idToken) {
    return (
      <section className="section container" style={styles.wrap}>
        <img src={bgImage} alt="" style={styles.bgImg} />
        <div style={styles.overlay} />

        <div style={styles.content}>
          <h2 style={styles.pageTitle}>Agents Lab</h2>

          <div style={styles.loginBox}>
            <p style={styles.loginText}>
              {t('ail.loginReserved')}
            </p>

            {authError && (
              <p style={styles.authErrorText}>⚠️ {authError}</p>
            )}

            <div ref={buttonRef} style={styles.googleButtonSlot} />

            {!gsiReady && !authError && (
              <p style={styles.loadingText}>
                {t('ail.loadingGoogle')}
              </p>
            )}
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="section container" style={styles.wrap}>
      <img src={bgImage} alt="" style={styles.bgImg} />
      <div style={styles.overlay} />

      <div style={styles.contentWide}>
        <div style={styles.titleRow}>
          <div>
            <h2 style={styles.pageTitle}>Agents Lab</h2>

            <p style={styles.subtitle}>
              {t('ail.subtitle')}{' '}
              <code style={styles.codeInline}>
                emergence_flow
              </code>
            </p>
          </div>

          <div style={styles.sessionBox}>
            <span style={styles.sessionLabel}>
              {profile?.email || t('ail.googleAccount')}
            </span>

            <button
              type="button"
              onClick={logout}
              style={styles.logoutButton}
            >
              {t('ail.logout')}
            </button>
          </div>
        </div>

        {/* ============================================================
            TABS — Agents Lab
        ============================================================ */}
        <div style={styles.tabBar}>
          <button
            type="button"
            onClick={() => setActiveTab('emergence')}
            style={{
              ...styles.tabBtn,
              ...(activeTab === 'emergence' ? styles.tabBtnActive : {}),
            }}
          >
            🌌 Emergence
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('ns')}
            style={{
              ...styles.tabBtn,
              ...(activeTab === 'ns' ? styles.tabBtnActive : {}),
            }}
          >
            🌙 Night Story
          </button>
        </div>

        {activeTab === 'ns' && (
          <div style={styles.promptPanel}>
            <div style={styles.promptPanelHeader}>
              <div>
                <span style={styles.label}>🌙 Prompt Night Story</span>

                <p style={styles.promptHint}>
                  Modifica il testo che Night Story usa per raccontare. Il
                  salvataggio aggiorna subito la cache dell'agente: la
                  prossima storia userà il nuovo testo.
                </p>
              </div>

              <div style={styles.selectedRoleRow}>
                <button
                  type="button"
                  onClick={fetchNsPrompts}
                  disabled={nsBusy}
                  style={{
                    ...styles.secondaryBtn,
                    ...(nsBusy ? styles.buttonDisabled : {}),
                  }}
                >
                  ↻ Aggiorna
                </button>
              </div>
            </div>

            {nsBusy && !nsPrompts && (
              <p style={{ color: '#8fa1ac', margin: 0, fontSize: '0.85rem' }}>
                Carico i prompt da Night Story…
              </p>
            )}

            {nsError && (
              <p style={{ color: '#ff8f8f', margin: '0.5rem 0 0', fontSize: '0.85rem' }}>
                ⚠️ {nsError}
              </p>
            )}

            {nsPrompts && nsPrompts.length === 0 && (
              <p style={{ color: '#8fa1ac', margin: 0, fontSize: '0.85rem' }}>
                Nessun prompt trovato su Night Story (il servizio è attivo?).
              </p>
            )}

            {nsPrompts && nsPrompts.length > 0 && (
              <>
                <div style={styles.promptRoleGrid}>
                  {nsPrompts.map((p) => (
                    <button
                      key={p.name}
                      type="button"
                      disabled={nsBusy}
                      onClick={() => selectNsPrompt(p.name)}
                      style={{
                        ...styles.promptRoleBtn,
                        ...(nsSelected === p.name
                          ? styles.promptRoleBtnActive
                          : {}),
                      }}
                    >
                      <span style={styles.promptRoleIcon}>
                        {p.name.startsWith('genre_') ? '🎭' : '📜'}
                      </span>

                      <span>{p.name}</span>
                    </button>
                  ))}
                </div>

                {nsSelected && (
                  <div style={{ ...styles.response, marginTop: '0.85rem', marginBottom: 0 }}>
                    <div style={styles.responseHeader}>
                      <h3 style={styles.responseTitle}>{nsSelected}</h3>

                      <span style={styles.sessionLabel}>
                        {nsText.length.toLocaleString('it-IT')} caratteri
                      </span>
                    </div>

                    <textarea
                      value={nsText}
                      onChange={(e) => setNsText(e.target.value)}
                      style={styles.promptTextarea}
                      rows={16}
                    />

                    <div
                      style={{
                        display: 'flex',
                        gap: '0.5rem',
                        marginTop: '0.65rem',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                      }}
                    >
                      <button
                        type="button"
                        onClick={saveNsPrompt}
                        disabled={nsBusy || !nsText.trim()}
                        style={{
                          ...styles.editBtn,
                          ...(nsBusy || !nsText.trim()
                            ? styles.buttonDisabled
                            : {}),
                        }}
                      >
                        {nsBusy ? 'Salvo…' : '💾 Salva su Night Story'}
                      </button>

                      <button
                        type="button"
                        onClick={() => selectNsPrompt(nsSelected)}
                        style={styles.secondaryBtn}
                      >
                        Ripristina
                      </button>

                      {nsStatus && (
                        <span style={styles.sessionLabel}>{nsStatus}</span>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {activeTab === 'emergence' && (<>

        {/* ============================================================
            EMERGENCE ROLE PROMPTS
        ============================================================ */}

        <div style={styles.promptPanel}>
          <div style={styles.promptPanelHeader}>
            <div>
              <span style={styles.label}>{t('ail.rolesLabel')}</span>

              <p style={styles.promptHint}>
                {t('ail.rolesHint')}
              </p>
            </div>

            {/* Badge ruolo + Edit un po' più a sinistra */}
            {selectedPromptRole && (
              <div style={styles.selectedRoleRow}>
                <span style={styles.selectedRole}>
                  {ROLE_ICONS[selectedPromptRole]} {selectedPromptRole}
                </span>

                <button
                  type="button"
                  disabled={isLoading || !response}
                  onClick={handleEditPrompt}
                  style={{
                    ...styles.editBtn,
                    ...(isLoading || !response ? styles.buttonDisabled : {}),
                  }}
                  title="Update emergence prompt"
                >
                  {t('ail.edit')}
                </button>
              </div>
            )}
          </div>

          <div style={styles.promptRoleGrid}>
            {DEFAULT_PIPELINE.map((role) => (
              <button
                key={role}
                type="button"
                disabled={isLoading}
                onClick={() => handlePromptRole(role)}
                style={{
                  ...styles.promptRoleBtn,
                  ...(selectedPromptRole === role
                    ? styles.promptRoleBtnActive
                    : {}),
                }}
              >
                <span style={styles.promptRoleIcon}>
                  {ROLE_ICONS[role]}
                </span>

                <span>{role}</span>
              </button>
            ))}
          </div>

          {/* System Prompt subito sotto i roles */}
          {selectedPromptRole && (response || isLoading) && (
            <div style={{ ...styles.response, marginTop: '0.85rem', marginBottom: 0 }}>
              <div style={styles.responseHeader}>
                <h3 style={styles.responseTitle}>
                  {isLoading ? t('ail.loadingPrompt', { role: selectedPromptRole }) : t('ail.systemPrompt', { role: selectedPromptRole })}
                </h3>

                <button
                  type="button"
                  onClick={() => {
                    setResponse('')
                    setSelectedPromptRole(null)
                  }}
                  style={styles.secondaryBtn}
                >
                  {t('ail.close')}
                </button>
              </div>

              {isLoading ? (
                <p style={{ color: '#8fa1ac', margin: 0, fontSize: '0.85rem' }}>
                    {t('ail.fetchingPrompt')}
                </p>
               ) : editingPrompt ? (
                <>
                    <textarea
                      value={response}
                      onChange={(e) => setResponse(e.target.value)}
                      style={styles.promptTextarea}
                      rows={14}
                      autoFocus
                    />

                    <div
                      style={{
                      display: 'flex',
                      gap: '0.5rem',
                      marginTop: '0.65rem',
                    }}
                    >
                    <button
                        type="button"
                        onClick={handleUpdatePrompt}
                        disabled={!response.trim() || isLoading}
                        style={{
                        ...styles.editBtn,
                        ...(!response.trim() || isLoading
                            ? styles.buttonDisabled
                            : {}),
                        }}
                    >
                        {t('ail.update')}
                    </button>

                    <button
                        type="button"
                        onClick={() => setEditingPrompt(false)}
                        style={styles.secondaryBtn}
                    >
                        {t('ail.cancel')}
                    </button>
                    </div>
                </>
                ) : (
                  <pre style={styles.responsePre}>{response}</pre>
                )}
            </div>
          )}
        </div>

        {/* ============================================================
            MAIN CONFIGURATION
        ============================================================ */}

        <form onSubmit={handleLaunch} style={styles.form}>
          <div style={styles.grid2}>
            <label style={styles.field}>
              <span style={styles.label}>{t('ail.worldId')}</span>

              <input
                type="number"
                min={1}
                value={worldId}
                onChange={(e) => setWorldId(e.target.value)}
                style={styles.input}
              />
            </label>

            <label style={styles.field}>
              <span style={styles.label}>{t('ail.iterations')}</span>

              <input
                type="number"
                min={1}
                max={50}
                value={numIterations}
                onChange={(e) => setNumIterations(e.target.value)}
                style={styles.input}
              />
            </label>

            <label style={styles.field}>
              <span style={styles.label}>{t('ail.judgeModel')}</span>

              <select
                value={judgeModel}
                onChange={(e) => setJudgeModel(e.target.value)}
                style={styles.input}
              >
                {MODEL_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>

            <label style={styles.field}>
              <span style={styles.label}>{t('ail.targetRole')}</span>

              <select
                value={targetRole}
                onChange={(e) => setTargetRole(e.target.value)}
                style={styles.input}
              >
                {pipeline.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div style={styles.sectionBlock}>
            <div style={styles.sectionHeader}>
              <span style={styles.label}>
                {t('ail.pipelineSection')}
              </span>

              <button
                type="button"
                onClick={resetDefaults}
                style={styles.secondaryBtn}
              >
                {t('ail.resetDefaults')}
              </button>
            </div>

            <div style={styles.roleGrid}>
              {DEFAULT_PIPELINE.map((role) => {
                const active = pipeline.includes(role)

                return (
                  <div
                    key={role}
                    style={{
                      ...styles.roleCard,
                      ...(active ? {} : styles.roleCardOff),
                    }}
                  >
                    <label style={styles.roleCheck}>
                      <input
                        type="checkbox"
                        checked={active}
                        onChange={() => toggleRole(role)}
                      />

                      <strong>{role}</strong>
                    </label>

                    <select
                      disabled={!active}
                      value={overrides[role] || 'gemma4'}
                      onChange={(e) =>
                        setOverride(role, e.target.value)
                      }
                      style={styles.input}
                    >
                      {MODEL_OPTIONS.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                )
              })}
            </div>
          </div>

          <div style={styles.sectionBlock}>
            <button
              type="button"
              onClick={() => setShowConf((v) => !v)}
              style={styles.secondaryBtn}
            >
              {showConf ? t('ail.hideConf') : t('ail.showConf')}
            </button>

            {showConf && (
              <pre style={styles.confPre}>
                {JSON.stringify(
                  {
                    ...confObject,
                    pipeline_config: JSON.parse(
                      confObject.pipeline_config
                    ),
                  },
                  null,
                  2
                )}
              </pre>
            )}
          </div>

          <div style={styles.actionsRow}>
            <button
              type="submit"
              disabled={isLoading || pipeline.length === 0}
              style={{
                ...styles.launchBtn,
                ...(isLoading || pipeline.length === 0
                  ? styles.buttonDisabled
                  : {}),
              }}
            >
              {isLoading ? t('ail.launching') : t('ail.launch')}
            </button>

            <button
              type="button"
              disabled={isLoading}
              onClick={() => {
                setSelectedPromptRole(null)
                sendCommand('status dag emergence_flow')
              }}
              style={styles.secondaryBtn}
            >
              Status DAG
            </button>

            <button
              type="button"
              disabled={isLoading}
              onClick={() => {
                setSelectedPromptRole(null)
                sendCommand('QE last 10')
              }}
              style={styles.secondaryBtn}
            >
              QE last 10
            </button>

            <Link to="/test5" style={styles.linkBtn}>
              Console Leles →
            </Link>
          </div>
        </form>

        {error && (
          <div style={styles.errorBox}>
            <strong>{t('ail.error')}</strong>
            <p>{error}</p>
          </div>
        )}

        {/* Risposte normali (Launch / Status / QE) in basso */}
        {response && !selectedPromptRole && (
          <div style={styles.response}>
            <div style={styles.responseHeader}>
              <h3 style={styles.responseTitle}>{t('ail.response')}</h3>

              <button
                type="button"
                onClick={() => setResponse('')}
                style={styles.secondaryBtn}
              >
                {t('ail.close')}
              </button>
            </div>

            <pre style={styles.responsePre}>
              {response}
            </pre>
          </div>
        )}
        </>)}
      </div>
    </section>
  )
}

const styles = {
  wrap: {
    position: 'relative',
    minHeight: '100vh',
    paddingTop: '5.5rem',
    paddingBottom: '3rem',
  },

  bgImg: {
    position: 'fixed',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    opacity: 0.35,
    zIndex: 0,
    pointerEvents: 'none',
  },

  overlay: {
    position: 'fixed',
    inset: 0,
    background:
      'linear-gradient(180deg, rgba(8,12,18,0.15) 0%, rgba(8,12,18,0.25) 100%)',
    zIndex: 0,
    pointerEvents: 'none',
  },

  content: {
    position: 'relative',
    zIndex: 1,
    maxWidth: 520,
    margin: '0 auto',
  },

  contentWide: {
    position: 'relative',
    zIndex: 1,
    maxWidth: 960,
    margin: '0 auto',
  },

  pageTitle: {
    margin: 0,
    fontSize: '1.75rem',
    color: '#e8f1f5',
  },

  subtitle: {
    margin: '0.35rem 0 0',
    color: '#8fa1ac',
    fontSize: '0.9rem',
  },

  codeInline: {
    color: '#3fd0c9',
    fontSize: '0.85rem',
  },

  titleRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '1rem',
    marginBottom: '1.25rem',
    flexWrap: 'wrap',
  },

  sessionBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.6rem',
  },

  sessionLabel: {
    color: '#a8b8c4',
    fontSize: '0.85rem',
  },

  logoutButton: {
    background: 'transparent',
    border: '1px solid #3a4a58',
    color: '#c5d4de',
    borderRadius: 999,
    padding: '0.35rem 0.85rem',
    cursor: 'pointer',
    fontSize: '0.8rem',
  },

  loginBox: {
    marginTop: '1.5rem',
    padding: '1.5rem',
    background: 'rgba(18,26,34,0.85)',
    border: '1px solid #1f2b35',
    borderRadius: 12,
    textAlign: 'center',
  },

  loginText: {
    color: '#c5d4de',
    marginBottom: '1rem',
  },

  authErrorText: {
    color: '#ff8f8f',
    marginBottom: '0.75rem',
  },

  loadingText: {
    color: '#8fa1ac',
    fontSize: '0.85rem',
  },

  googleButtonSlot: {
    display: 'flex',
    justifyContent: 'center',
    minHeight: 40,
  },

  /* ================================================================
     TABS — Agents Lab
  ================================================================ */

  tabBar: {
    display: 'flex',
    gap: '0.45rem',
    marginBottom: '1rem',
    flexWrap: 'wrap',
  },

  tabBtn: {
    background: '#0b1015',
    border: '1px solid #2a3a48',
    color: '#c5d4de',
    borderRadius: 999,
    padding: '0.5rem 0.95rem',
    cursor: 'pointer',
    fontSize: '0.85rem',
    fontWeight: 600,
    transition: 'all 0.15s ease',
  },

  tabBtnActive: {
    border: '1px solid #3fd0c9',
    color: '#e8f1f5',
    background: 'rgba(63,208,201,0.1)',
  },

  /* ================================================================
     PROMPT ROLE PANEL
  ================================================================ */

  promptPanel: {
    marginBottom: '1rem',
    background: 'rgba(18,26,34,0.88)',
    border: '1px solid #1f2b35',
    borderRadius: 12,
    padding: '1rem',
  },

  promptPanelHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '1rem',
    marginBottom: '0.75rem',
    flexWrap: 'wrap',
  },

  promptHint: {
    margin: '0.25rem 0 0',
    color: '#718491',
    fontSize: '0.78rem',
  },

  selectedRoleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    marginLeft: 'auto',
    marginRight: '0.5rem', // un po' più a sinistra rispetto a prima
  },

  selectedRole: {
    color: '#3fd0c9',
    fontSize: '0.8rem',
    fontWeight: 600,
    padding: '0.35rem 0.65rem',
    border: '1px solid #24504f',
    borderRadius: 999,
    background: 'rgba(63,208,201,0.06)',
  },

  editBtn: {
    background: 'rgba(63,208,201,0.12)',
    border: '1px solid #3fd0c9',
    color: '#3fd0c9',
    borderRadius: 999,
    padding: '0.3rem 0.7rem',
    cursor: 'pointer',
    fontSize: '0.75rem',
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    gap: '0.25rem',
  },

  promptRoleGrid: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.45rem',
  },

  promptRoleBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    background: '#0b1015',
    border: '1px solid #2a3a48',
    color: '#c5d4de',
    borderRadius: 999,
    padding: '0.45rem 0.7rem',
    cursor: 'pointer',
    fontSize: '0.78rem',
    transition: 'all 0.15s ease',
  },

  promptRoleBtnActive: {
    border: '1px solid #3fd0c9',
    color: '#e8f1f5',
    background: 'rgba(63,208,201,0.1)',
  },

  promptRoleIcon: {
    fontSize: '1rem',
    lineHeight: 1,
  },

  /* ================================================================
     MAIN FORM
  ================================================================ */

  form: {
    background: 'rgba(18,26,34,0.88)',
    border: '1px solid #1f2b35',
    borderRadius: 12,
    padding: '1.25rem',
  },

  grid2: {
    display: 'grid',
    gridTemplateColumns:
      'repeat(auto-fit, minmax(180px, 1fr))',
    gap: '0.85rem',
    marginBottom: '1.25rem',
  },

  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.35rem',
  },

  label: {
    color: '#8fa1ac',
    fontSize: '0.75rem',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },

  input: {
    background: '#0b1015',
    border: '1px solid #2a3a48',
    borderRadius: 8,
    color: '#e8f1f5',
    padding: '0.55rem 0.7rem',
    fontSize: '0.9rem',
  },

  sectionBlock: {
    marginBottom: '1.1rem',
  },

  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '0.65rem',
  },

  roleGrid: {
    display: 'grid',
    gridTemplateColumns:
      'repeat(auto-fill, minmax(200px, 1fr))',
    gap: '0.65rem',
  },

  roleCard: {
    background: '#0f161c',
    border: '1px solid #2a3a48',
    borderRadius: 10,
    padding: '0.65rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.45rem',
  },

  roleCardOff: {
    opacity: 0.45,
  },

  roleCheck: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.45rem',
    color: '#e8f1f5',
    fontSize: '0.9rem',
  },

  confPre: {
    marginTop: '0.65rem',
    background: '#0b1015',
    border: '1px solid #2a3a48',
    borderRadius: 8,
    padding: '0.85rem',
    color: '#9ec9c4',
    fontSize: '11px',
    overflow: 'auto',
    maxHeight: 280,
    whiteSpace: 'pre-wrap',
  },

  actionsRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.6rem',
    alignItems: 'center',
  },

  launchBtn: {
    background:
      'linear-gradient(135deg, #2dd4bf, #0ea5e9)',
    border: 'none',
    color: '#041016',
    fontWeight: 700,
    borderRadius: 999,
    padding: '0.65rem 1.25rem',
    cursor: 'pointer',
    fontSize: '0.95rem',
  },

  secondaryBtn: {
    background: 'transparent',
    border: '1px solid #3a4a58',
    color: '#c5d4de',
    borderRadius: 999,
    padding: '0.5rem 0.9rem',
    cursor: 'pointer',
    fontSize: '0.8rem',
  },

  linkBtn: {
    color: '#3fd0c9',
    fontSize: '0.85rem',
    textDecoration: 'none',
    marginLeft: 'auto',
  },

  buttonDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },

  errorBox: {
    marginTop: '1rem',
    padding: '0.9rem',
    background: 'rgba(80,20,20,0.55)',
    border: '1px solid #7a3030',
    borderRadius: 10,
    color: '#ffc9c9',
  },

  response: {
    marginTop: '1rem',
    background: 'rgba(18,26,34,0.92)',
    border: '1px solid #1f2b35',
    borderRadius: 12,
    padding: '1rem',
  },

  responseHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '0.5rem',
  },

  responseTitle: {
    margin: 0,
    fontSize: '1rem',
    color: '#e8f1f5',
  },

  promptTextarea: {
    width: '100%',
    boxSizing: 'border-box',
    minHeight: 260,
    resize: 'vertical',
    background: '#0b1015',
    border: '1px solid #3fd0c9',
    borderRadius: 8,
    color: '#e8f1f5',
    padding: '0.85rem',
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '12px',
    lineHeight: 1.55,
    outline: 'none',
  },

  responsePre: {
    margin: 0,
    color: '#c5d4de',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '12px',
    lineHeight: 1.55,
  },
}
