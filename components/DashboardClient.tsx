'use client'

import React, { useState, useEffect, useRef, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import { MAX_DAILY_CAP, MAX_INITIAL_SENDS_PER_DAY } from '@/lib/constants'
import { Ghost, Search, Palette, Zap, Target, ClipboardList, Send, X, Trash2, Edit2, CheckCircle2, Globe, Phone, ChevronRight, RefreshCw, Sparkles, AlertTriangle, Play, Smartphone } from 'lucide-react'

export interface AuditIssue {
  severity?: string
  title: string
  detail: string
}

interface PageSpeedDetails {
  performanceScore: number | null
  largestContentfulPaint?: string | null
  speedIndex?: string | null
  totalBlockingTime?: string | null
}

export interface AuditDetails {
  sourceUrl?: string
  observedAt?: string
  verifiedFactEvidence?: Array<{ fact: string; sourceUrl: string; observedAt: string }>
  topIssues?: AuditIssue[]
  quickWins?: string[]
  verifiedFacts?: string[]
  pageSpeed?: PageSpeedDetails
}

export interface Lead {
  id: string
  business_name: string
  address: string | null
  website: string | null
  email: string | null
  status: string
  seo_score: number | null
  seo_flags: string | null
  mobile_score: number | null
  performance_score: number | null
  design_score: number | null
  ux_score: number | null
  technical_score: number | null
  opportunity_score: number | null
  outreach_angle: string | null
  outreach_reason: string | null
  email_confidence: string | null
  email_source: string | null
  email_source_url: string | null
  email_verification_status: string | null
  email_verified_at: string | null
  email_verification_method: string | null
  phone: string | null
  audit_details: AuditDetails | null
  generated_subject: string | null
  generated_body: string | null
  generation_policy_version: string | null
  initial_approval_status: string
  initial_approved_at: string | null
  initial_approved_by: string | null
  followup_approval_status: string
  followup_approved_at: string | null
  followup_approved_by: string | null
  followup_subject: string | null
  followup_body: string | null
  initial_sent_at: string | null
  initial_opened_at: string | null
  followup_sent_at: string | null
  followup_opened_at: string | null
  replied_at: string | null
  last_audited_at: string | null
  audit_attempts: number
  audit_next_attempt_at: string | null
  created_at: string
}

export interface LeadInteraction {
  id: string
  lead_id: string
  channel: string
  outcome: string
  note: string | null
  occurred_at: string
  next_action_at: string | null
  created_at: string
}

export interface Niche {
  id: string
  label: string
  city: string
  status: string
  source: string
  reasoning: string | null
  created_at: string
}

export interface Settings {
  daily_cap: number
  paused: boolean
  last_run_at: string | null
  gmail_user?: string | null
  replies_count?: number
}

export interface Stats {
  total: number
  sent_total: number
  replies_total: number
  opened_total?: number
  sent_today: number
  audited_total: number
  ready_to_contact: number
  avg_opportunity: number
  avg_seo: number
  avg_mobile: number
  conversations: number
  walkthroughs: number
  proposals: number
  paid_pilots: number
}

export interface ErrorRecord {
  id: string
  source: 'pipeline' | 'discover'
  stage: string
  message: string
  context: unknown | null
  created_at: string
}

interface DashboardClientProps {
  initialSettings: Settings
  initialNiches: Niche[]
  initialLeads: Lead[]
  initialInteractions: LeadInteraction[]
  initialErrors: ErrorRecord[]
  stats: Stats
  statusCounts: Record<string, number>
  defaultIndustries: string[]
  defaultCities: string[]
}

const LEAD_STATUS_TABS = ['all', 'new', 'email_needed', 'scraped', 'generated', 'sent', 'followed_up', 'no_website', 'failed', 'send_uncertain', 'unsubscribed'] as const
const PAGE_SIZE_OPTIONS = [10, 25, 50]

function getLeadNextAction(lead: Lead): string {
  if (lead.status === 'unsubscribed') return 'Do not contact'
  if (lead.status === 'send_uncertain') return 'Check mailbox before any retry'
  if (lead.replied_at) return 'Reply received'
  if (lead.audit_next_attempt_at) return 'Website audit retry scheduled'
  if (!lead.email) return lead.website ? 'Crawl website for email' : 'Add email or use phone'
  if (!lead.last_audited_at && lead.website) return 'Run website audit'
  if (lead.email_verification_status !== 'source_verified') return 'Verify contact source before approval'
  if (!lead.generated_body) return 'Generate pitch for review'
  if (!lead.initial_sent_at && lead.generation_policy_version !== 'permission-v1') return 'Regenerate permission-first draft'
  if (!lead.initial_sent_at && lead.initial_approval_status !== 'approved') return 'Approve pitch for sending'
  if (!lead.initial_sent_at) return 'Review pitch before sending'
  if (!lead.followup_sent_at && lead.followup_body && lead.followup_approval_status !== 'approved') return 'Approve follow-up for sending'
  if (!lead.followup_sent_at && lead.followup_approval_status === 'approved') return 'Follow-up approved, awaiting dispatch'
  return lead.followup_sent_at ? 'Follow-up sent' : 'Monitor for reply'
}

function PaginationControls({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, total)
  const pageNumbers: number[] = []
  const window = 2
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || (p >= page - window && p <= page + window)) {
      pageNumbers.push(p)
    } else if (pageNumbers[pageNumbers.length - 1] !== -1) {
      pageNumbers.push(-1)
    }
  }

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-6 py-4 border-t border-[#c8c4bc12] text-xs font-mono">
      <div className="text-[#c8c4bc70] text-[11px] tracking-wider">
        {total === 0 ? '0 prospects' : `Showing ${start}–${end} of ${total}`}
      </div>
      <div className="flex items-center gap-3">
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(parseInt(e.target.value, 10))}
          className="px-2.5 py-1.5 bg-[#171717] border border-[#c8c4bc1a] rounded-md text-[#c8c4bc] focus:outline-none focus:border-[#8b3a2a] text-[11px] tracking-wider cursor-pointer"
          aria-label="Rows per page"
        >
          {PAGE_SIZE_OPTIONS.map((size) => (
            <option key={size} value={size}>
              {size} / page
            </option>
          ))}
        </select>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            className="px-2.5 py-1 rounded-md border border-[#c8c4bc1a] bg-[#171717] text-[#c8c4bc80] text-[11px] disabled:opacity-25 disabled:cursor-not-allowed hover:text-[#c8c4bc] hover:border-[#c8c4bc33] transition-colors"
          >
            Prev
          </button>
          {pageNumbers.map((p, index) =>
            p === -1 ? (
              <span key={`ellipsis-${index}`} className="px-1 text-[#c8c4bc30]">
                …
              </span>
            ) : (
              <button
                key={p}
                onClick={() => onPageChange(p)}
                className={`w-7 h-7 rounded-md text-[11px] font-mono transition-colors ${
                  p === page
                    ? 'bg-[#8b3a2a] text-[#c8c4bc] font-medium'
                    : 'text-[#c8c4bc70] hover:text-[#c8c4bc] hover:bg-[#222]'
                }`}
              >
                {p}
              </button>
            )
          )}
          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            className="px-2.5 py-1 rounded-md border border-[#c8c4bc1a] bg-[#171717] text-[#c8c4bc80] text-[11px] disabled:opacity-25 disabled:cursor-not-allowed hover:text-[#c8c4bc] hover:border-[#c8c4bc33] transition-colors"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}

function ScorePill({ score, label }: { score: number | null; label?: string }) {
  if (score === null || score === undefined) {
    return <span className="text-[#c8c4bc30] text-[11px] font-mono">—</span>
  }
  let color = 'text-[#c8c4bc50]'
  let bg = 'bg-[#c8c4bc08]'
  if (score <= 35) {
    color = 'text-[#e85d4a]'
    bg = 'bg-[#8b3a2a15]'
  } else if (score <= 60) {
    color = 'text-[#c8a44b]'
    bg = 'bg-[#c8a44b12]'
  } else {
    color = 'text-[#6dc86d]'
    bg = 'bg-[#6dc86d12]'
  }
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-mono ${color} ${bg}`}>
      {score}
      {label && <span className="text-[10px] opacity-60">{label}</span>}
    </span>
  )
}

function OpportunityBadge({ score }: { score: number | null }) {
  if (score === null || score === undefined) {
    return <span className="text-[#c8c4bc30] text-[11px] font-mono">—</span>
  }
  let label = 'Low'
  let cls = 'text-[#c8c4bc50] bg-[#c8c4bc0a]'
  if (score >= 70) {
    label = 'Hot'
    cls = 'text-[#e85d4a] bg-[#8b3a2a20] border border-[#8b3a2a50]'
  } else if (score >= 50) {
    label = 'Warm'
    cls = 'text-[#c8a44b] bg-[#c8a44b15] border border-[#c8a44b40]'
  } else if (score >= 30) {
    label = 'Fair'
    cls = 'text-[#c8c4bc90] bg-[#c8c4bc0d] border border-[#c8c4bc20]'
  }
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-mono font-medium ${cls}`}>
      {score}
      <span className="text-[10px] opacity-75">· {label}</span>
    </span>
  )
}

function AnglePill({ angle }: { angle: string | null }) {
  if (!angle) return <span className="text-[#c8c4bc30] text-[11px] font-mono">—</span>
  const icons: Record<string, string> = {
    mobile: '<Smartphone size={14} className="inline mr-1" />',
    seo: '<Search size={14} className="inline mr-1" />',
    design: '<Palette size={14} className="inline mr-1" />',
    performance: '<Zap size={14} className="inline mr-1" />',
    conversion: '<Target size={14} className="inline mr-1" />',
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono text-[#c8c4bc] bg-[#c8c4bc0a] border border-[#c8c4bc15] capitalize">
      <span>{icons[angle] || '<ClipboardList size={14} className="inline mr-1" />'}</span>
      {angle}
    </span>
  )
}

function ConfidenceDot({ confidence }: { confidence: string | null }) {
  if (!confidence) return null
  let cls = 'bg-[#c8c4bc30]'
  let title = 'Unknown'
  if (confidence === 'HIGH') {
    cls = 'bg-[#6dc86d]'
    title = 'High confidence email'
  } else if (confidence === 'MEDIUM') {
    cls = 'bg-[#c8a44b]'
    title = 'Medium confidence email'
  } else {
    cls = 'bg-[#e85d4a]'
    title = 'Low confidence email'
  }
  return <span className={`w-1.5 h-1.5 rounded-full inline-block ${cls}`} title={title} />
}

export default function DashboardClient({
  initialSettings,
  initialNiches,
  initialLeads,
  initialInteractions,
  initialErrors,
  stats,
  statusCounts,
  defaultIndustries,
  defaultCities,
}: DashboardClientProps) {
  const router = useRouter()
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )

  const [settingsMessage, setSettingsMessage] = useState('')

  // Clean and sanitize URL query parameters on mount (prevent sensitive email/auth params from lingering in the browser URL and history)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const auth = params.get('auth')
    const email = params.get('email')
    const authError = params.get('auth_error')

    if (auth === 'gmail_connected' || authError) {
      const message = auth === 'gmail_connected'
        ? `Gmail connected successfully for ${email || 'your account'}!`
        : `Google OAuth connection notice: ${authError}`
      const timer = window.setTimeout(() => setSettingsMessage(message), 0)
      if (auth === 'gmail_connected') {
        window.history.replaceState({}, document.title, window.location.pathname)
      } else if (authError) {
        window.history.replaceState({}, document.title, window.location.pathname)
      }
      return () => window.clearTimeout(timer)
    }
  }, [])

  const [activeTab, setActiveTab] = useState<'leads' | 'targeting' | 'settings' | 'errors'>('leads')

  // Leads filters & pagination
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [expandedLeadId, setExpandedLeadId] = useState<string | null>(null)
  const [leadsPage, setLeadsPage] = useState(1)
  const [leadsPageSize, setLeadsPageSize] = useState(25)
  const [nichesPage, setNichesPage] = useState(1)
  const [nichesPageSize, setNichesPageSize] = useState(10)

  // Errors modal & pagination
  const [expandedErrorId, setExpandedErrorId] = useState<string | null>(null)
  const [errorsPage, setErrorsPage] = useState(1)
  const [errorsPageSize, setErrorsPageSize] = useState(25)

  // Settings
  const [dailyCap, setDailyCap] = useState<number | string>(
    initialSettings?.daily_cap != null && !isNaN(Number(initialSettings.daily_cap))
      ? Number(initialSettings.daily_cap)
      : 50
  )
  const [paused, setPaused] = useState(Boolean(initialSettings?.paused))
  const [settingsLoading, setSettingsLoading] = useState(false)

  // Manual Trigger action state
  const [manualRunningAction, setManualRunningAction] = useState<'discover' | 'pipeline' | 'enrich_emails' | 'dry_run' | 'send_outreach' | null>(null)
  const [manualRunLogs, setManualRunLogs] = useState<string[] | null>(null)
  const [manualRunError, setManualRunError] = useState<string | null>(null)

  // Interactive Stats Card Modal State
  const [statsModalType, setStatsModalType] = useState<
    'prospect_pool' | 'audited' | 'ready_to_contact' | 'sent_today' | 'total_dispatched' | 'replies' | null
  >(null)
  const [statsModalSearch, setStatsModalSearch] = useState('')

  // Single Lead Email Scraping / Enrichment
  const [enrichingLeadId, setEnrichingLeadId] = useState<string | null>(null)
  const [leadEnrichFeedback, setLeadEnrichFeedback] = useState<{ leadId: string; message: string; success: boolean } | null>(null)

  // Lead CRUD & Multi-select State
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([])
  const [editingLead, setEditingLead] = useState<Lead | null>(null)
  const [editForm, setEditForm] = useState({
    business_name: '',
    email: '',
    website: '',
    phone: '',
    address: '',
    status: 'new',
  })
  const [editLoading, setEditLoading] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // Clear data confirmation modal
  const [isClearModalOpen, setIsClearModalOpen] = useState(false)
  const [clearSuppressed, setClearSuppressed] = useState(true)
  const [isClearing, setIsClearing] = useState(false)

  // Lead action in-flight IDs
  const [reauditingLeadId, setReauditingLeadId] = useState<string | null>(null)
  const [regeneratingLeadId, setRegeneratingLeadId] = useState<string | null>(null)
  const [deletingLeadId, setDeletingLeadId] = useState<string | null>(null)
  const [bulkActionLoading, setBulkActionLoading] = useState(false)

  // Manual Lead Entry
  const [leadName, setLeadName] = useState('')
  const [leadWebsite, setLeadWebsite] = useState('')
  const [leadEmail, setLeadEmail] = useState('')
  const [leadCity, setLeadCity] = useState('')
  const [leadLoading, setLeadLoading] = useState(false)
  const [leadMessage, setLeadMessage] = useState<{ text: string; success: boolean } | null>(null)

  // Copy feedback
  const [copiedField, setCopiedField] = useState<'subject' | 'body' | null>(null)

  // Commercial validation evidence
  const [interactionForm, setInteractionForm] = useState({
    channel: 'email',
    outcome: 'attempted',
    note: '',
    nextActionAt: '',
  })
  const [interactionLoading, setInteractionLoading] = useState(false)

  const handleToggleSelectLead = (leadId: string) => {
    setSelectedLeadIds((prev) =>
      prev.includes(leadId) ? prev.filter((id) => id !== leadId) : [...prev, leadId]
    )
  }

  const handleToggleSelectAll = (visibleIds: string[]) => {
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedLeadIds.includes(id))
    if (allSelected) {
      setSelectedLeadIds((prev) => prev.filter((id) => !visibleIds.includes(id)))
    } else {
      setSelectedLeadIds((prev) => Array.from(new Set([...prev, ...visibleIds])))
    }
  }

  const handleDeleteLead = async (leadId: string, businessName: string) => {
    if (!confirm(`Are you sure you want to delete "${businessName}"?`)) return
    setDeletingLeadId(leadId)
    try {
      const res = await fetch('/api/leads', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId }),
      })
      if (!res.ok) throw new Error('Failed to delete lead')
      setSelectedLeadIds((prev) => prev.filter((id) => id !== leadId))
      if (expandedLeadId === leadId) setExpandedLeadId(null)
      router.refresh()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setDeletingLeadId(null)
    }
  }

  const handleBulkDelete = async () => {
    if (selectedLeadIds.length === 0) return
    if (!confirm(`Are you sure you want to delete ${selectedLeadIds.length} selected leads?`)) return
    setBulkActionLoading(true)
    try {
      const res = await fetch('/api/leads', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadIds: selectedLeadIds }),
      })
      if (!res.ok) throw new Error('Bulk delete failed')
      setSelectedLeadIds([])
      router.refresh()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Bulk delete failed')
    } finally {
      setBulkActionLoading(false)
    }
  }

  const handleBulkReaudit = async () => {
    if (selectedLeadIds.length === 0) return
    setBulkActionLoading(true)
    try {
      for (const id of selectedLeadIds) {
        await fetch('/api/leads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'reaudit', leadId: id }),
        })
      }
      setSelectedLeadIds([])
      router.refresh()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Bulk re-audit failed')
    } finally {
      setBulkActionLoading(false)
    }
  }

  const handleBulkSend = async () => {
    if (selectedLeadIds.length === 0) return
    if (!confirm(`Approve generated drafts for ${selectedLeadIds.length} selected leads? No email will be sent by this action.`)) return
    setBulkActionLoading(true)
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve_bulk', leadIds: selectedLeadIds }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Bulk send failed')
      alert(data.message || 'Selected drafts approved for sending.')
      setSelectedLeadIds([])
      router.refresh()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Bulk send failed')
    } finally {
      setBulkActionLoading(false)
    }
  }

  const handleClearAllLeads = async () => {
    setIsClearing(true)
    try {
      const res = await fetch('/api/leads', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearAll: true, clearSuppressed }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to clear data')
      setIsClearModalOpen(false)
      setSelectedLeadIds([])
      router.refresh()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Clear failed')
    } finally {
      setIsClearing(false)
    }
  }

  const handleOpenEdit = (lead: Lead) => {
    setEditingLead(lead)
    setEditForm({
      business_name: lead.business_name || '',
      email: lead.email || '',
      website: lead.website || '',
      phone: lead.phone || '',
      address: lead.address || '',
      status: lead.status || 'new',
    })
    setEditError(null)
  }

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingLead) return
    setEditLoading(true)
    setEditError(null)

    try {
      const res = await fetch('/api/leads', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId: editingLead.id,
          ...editForm,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to update lead')
      setEditingLead(null)
      router.refresh()
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setEditLoading(false)
    }
  }

  const handleReauditLead = async (leadId: string) => {
    setReauditingLeadId(leadId)
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reaudit', leadId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Re-audit failed')
      router.refresh()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Re-audit failed')
    } finally {
      setReauditingLeadId(null)
    }
  }

  const handleRegeneratePitch = async (leadId: string) => {
    setRegeneratingLeadId(leadId)
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'regenerate', leadId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Pitch generation failed')
      router.refresh()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Pitch generation failed')
    } finally {
      setRegeneratingLeadId(null)
    }
  }

  // Toggle approval for a single generated draft. Neither action dispatches email.
  const [sendingLeadId, setSendingLeadId] = useState<string | null>(null)
  const handleSendSingle = async (leadId: string, currentlyApproved = false) => {
    const action = currentlyApproved ? 'revoke_approval' : 'approve_send'
    const prompt = currentlyApproved
      ? 'Revoke this draft approval? No email will be sent.'
      : 'Approve this generated email for sending? No email will be sent by this action.'
    if (!confirm(prompt)) return
    setSendingLeadId(leadId)
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, leadId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Approval update failed')
      alert(data.message || (currentlyApproved ? 'Approval revoked.' : 'Email approved for sending.'))
      router.refresh()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Approval update failed')
    } finally {
      setSendingLeadId(null)
    }
  }

  const handleFollowupApproval = async (leadId: string, currentlyApproved = false) => {
    const action = currentlyApproved ? 'revoke_followup' : 'approve_followup'
    const prompt = currentlyApproved
      ? 'Revoke this follow-up approval? No email will be sent.'
      : 'Approve this reviewed follow-up for sending? No email will be sent by this action.'
    if (!confirm(prompt)) return
    setSendingLeadId(leadId)
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, leadId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Follow-up approval update failed')
      alert(data.message || (currentlyApproved ? 'Follow-up approval revoked.' : 'Follow-up approved for sending.'))
      router.refresh()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Follow-up approval update failed')
    } finally {
      setSendingLeadId(null)
    }
  }

  // Enrich a single lead's email via search engines
  const [enrichingSingleId, setEnrichingSingleId] = useState<string | null>(null)
  const handleEnrichSingle = async (leadId: string) => {
    setEnrichingSingleId(leadId)
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'enrich_single', leadId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Enrichment failed')
      alert(data.message || 'Enrichment complete')
      router.refresh()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Enrichment failed')
    } finally {
      setEnrichingSingleId(null)
    }
  }

  // Run full pipeline (scrape → enrich → generate) for a single lead
  const [pipelineLeadId, setPipelineLeadId] = useState<string | null>(null)
  const handleRunLeadPipeline = async (leadId: string) => {
    setPipelineLeadId(leadId)
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'run_lead_pipeline', leadId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Pipeline failed')
      alert(data.message || 'Pipeline complete')
      router.refresh()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Pipeline failed')
    } finally {
      setPipelineLeadId(null)
    }
  }

  const [prevSettings, setPrevSettings] = useState(initialSettings)
  if (prevSettings !== initialSettings) {
    setPrevSettings(initialSettings)
    setDailyCap(
      initialSettings?.daily_cap != null && !isNaN(Number(initialSettings.daily_cap))
        ? Number(initialSettings.daily_cap)
        : 10
    )
    setPaused(Boolean(initialSettings?.paused))
  }

  const handleManualRun = async (action: 'discover' | 'pipeline' | 'enrich_emails' | 'dry_run' | 'send_outreach') => {
    setManualRunningAction(action)
    setManualRunLogs(null)
    setManualRunError(null)

    try {
      const res = await fetch('/api/manual-trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Execution encountered an issue.')
      setManualRunLogs(data.logs || ['Execution completed successfully.'])
      router.refresh()
    } catch (err: unknown) {
      setManualRunError(err instanceof Error ? err.message : 'Execution error')
    } finally {
      setManualRunningAction(null)
    }
  }

  const handleToggleLeadReply = async (leadId: string, replied: boolean) => {
    if (replied && !window.confirm('Confirm that this prospect actually replied. Coldstart will cancel any approved or queued follow-up for this prospect.')) return
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle_lead_reply', leadId, replied }),
      })
      if (res.ok) {
        router.refresh()
      }
    } catch {
      // ignore
    }
  }

  const handleAddInteraction = async (leadId: string) => {
    setInteractionLoading(true)
    try {
      const res = await fetch('/api/interactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId, ...interactionForm }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not record interaction')
      setInteractionForm({ channel: 'email', outcome: 'attempted', note: '', nextActionAt: '' })
      router.refresh()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Could not record interaction')
    } finally {
      setInteractionLoading(false)
    }
  }

  const handleRecordManualAttempt = async (leadId: string) => {
    const confirmed = window.confirm('Confirm that you already sent this message manually after re-checking the recipient and source page. Coldstart will only record the event; it will not send anything.')
    if (!confirmed) return

    setInteractionLoading(true)
    try {
      const res = await fetch('/api/interactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId,
          channel: 'email',
          outcome: 'attempted',
          note: 'Manual first contact sent after source and recipient re-check.',
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not record manual attempt')
      router.refresh()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Could not record manual attempt')
    } finally {
      setInteractionLoading(false)
    }
  }

  const handleEnrichLead = async (leadId: string) => {
    setEnrichingLeadId(leadId)
    setLeadEnrichFeedback(null)

    try {
      const res = await fetch('/api/enrich-emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'enrich_single', leadId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Email enrichment failed.')
      setLeadEnrichFeedback({
        leadId,
        message: data.message || 'Enrichment complete.',
        success: Boolean(data.result?.email),
      })
      router.refresh()
    } catch (err: unknown) {
      setLeadEnrichFeedback({
        leadId,
        message: err instanceof Error ? err.message : 'Enrichment error',
        success: false,
      })
    } finally {
      setEnrichingLeadId(null)
    }
  }

  const dialogRef = useRef<HTMLDivElement>(null)
  const statsDialogRef = useRef<HTMLDivElement>(null)
  const selectedLead = initialLeads.find((lead) => lead.id === expandedLeadId) || null
  const isEmailModalOpen = expandedLeadId !== null && selectedLead !== null
  const isStatsModalOpen = statsModalType !== null

  const errorDialogRef = useRef<HTMLDivElement>(null)
  const selectedError = initialErrors.find((error) => error.id === expandedErrorId) || null
  const isErrorModalOpen = expandedErrorId !== null && selectedError !== null

  const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

  useEffect(() => {
    if (!isEmailModalOpen && !isErrorModalOpen && !isStatsModalOpen) return
    const currentDialog = isEmailModalOpen
      ? dialogRef.current
      : isStatsModalOpen
      ? statsDialogRef.current
      : errorDialogRef.current
    currentDialog?.focus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setExpandedLeadId(null)
        setExpandedErrorId(null)
        setStatsModalType(null)
        return
      }
      if (e.key !== 'Tab' || !currentDialog) return
      const focusable = Array.from(currentDialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey && (active === first || active === currentDialog)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (active === last || active === currentDialog)) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = ''
    }
  }, [isEmailModalOpen, isErrorModalOpen, isStatsModalOpen])

  // Active niches sets
  const activeNiches = initialNiches.filter((n) => n.status === 'active')
  const activeIndustrySet = new Set(activeNiches.map((n) => n.label))
  const activeCitySet = new Set(activeNiches.map((n) => n.city))

  // Targeting multi-select (minimum 1)
  const [selectedIndustries, setSelectedIndustries] = useState<string[]>(
    defaultIndustries.filter((ind) => activeIndustrySet.has(ind)).length >= 1
      ? defaultIndustries.filter((ind) => activeIndustrySet.has(ind))
      : defaultIndustries.slice(0, 1)
  )
  const [selectedCities, setSelectedCities] = useState<string[]>(
    defaultCities.filter((city) => activeCitySet.has(city)).length >= 1
      ? defaultCities.filter((city) => activeCitySet.has(city))
      : defaultCities.slice(0, 1)
  )
  const [targetingLoading, setTargetingLoading] = useState(false)
  const [targetingError, setTargetingError] = useState('')
  const [targetingSuccess, setTargetingSuccess] = useState('')

  // Custom niche form
  const [customLabel, setCustomLabel] = useState('')
  const [customCity, setCustomCity] = useState('')
  const [customLoading, setCustomLoading] = useState(false)

  // Filter leads
  const filteredLeads = initialLeads.filter((lead) => {
    const matchesStatus = statusFilter === 'all' || lead.status === statusFilter
    const matchesSearch =
      !searchQuery ||
      lead.business_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (lead.email && lead.email.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (lead.website && lead.website.toLowerCase().includes(searchQuery.toLowerCase()))
    return matchesStatus && matchesSearch
  })

  const applyStatusFilter = (st: string) => {
    setStatusFilter(st)
    setLeadsPage(1)
  }
  const applySearchQuery = (q: string) => {
    setSearchQuery(q)
    setLeadsPage(1)
  }

  const leadsTotalPages = Math.max(1, Math.ceil(filteredLeads.length / leadsPageSize))
  const currentLeadsPage = Math.min(leadsPage, leadsTotalPages)
  const pagedLeads = filteredLeads.slice(
    (currentLeadsPage - 1) * leadsPageSize,
    currentLeadsPage * leadsPageSize
  )

  const nichesTotalPages = Math.max(1, Math.ceil(initialNiches.length / nichesPageSize))
  const currentNichesPage = Math.min(nichesPage, nichesTotalPages)
  const pagedNiches = initialNiches.slice(
    (currentNichesPage - 1) * nichesPageSize,
    currentNichesPage * nichesPageSize
  )

  const errorsTotalPages = Math.max(1, Math.ceil(initialErrors.length / errorsPageSize))
  const currentErrorsPage = Math.min(errorsPage, errorsTotalPages)
  const pagedErrors = initialErrors.slice(
    (currentErrorsPage - 1) * errorsPageSize,
    currentErrorsPage * errorsPageSize
  )

  // Handlers
  const handleUpdateSettings = async (e: React.FormEvent) => {
    e.preventDefault()
    setSettingsLoading(true)
    setSettingsMessage('')

    const parsedCap = typeof dailyCap === 'string' ? parseInt(dailyCap, 10) : dailyCap
    const numericCap = isNaN(parsedCap) ? 10 : Math.max(1, Math.min(MAX_DAILY_CAP, parsedCap))

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_settings', daily_cap: numericCap, paused }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to update settings')
      setSettingsMessage('Settings saved.')
      router.refresh()
    } catch (err: unknown) {
      setSettingsMessage(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setSettingsLoading(false)
    }
  }

  const handleToggleIndustry = (industry: string) => {
    if (selectedIndustries.includes(industry)) {
      if (selectedIndustries.length <= 1) {
        setTargetingError('Minimum 1 industry required.')
        return
      }
      setSelectedIndustries(selectedIndustries.filter((i) => i !== industry))
    } else {
      setSelectedIndustries([...selectedIndustries, industry])
      setTargetingError('')
    }
  }

  const handleToggleCity = (city: string) => {
    if (selectedCities.includes(city)) {
      if (selectedCities.length <= 1) {
        setTargetingError('Minimum 1 target city required.')
        return
      }
      setSelectedCities(selectedCities.filter((c) => c !== city))
    } else {
      setSelectedCities([...selectedCities, city])
      setTargetingError('')
    }
  }

  const handleSaveTargeting = async () => {
    if (selectedIndustries.length < 1 || selectedCities.length < 1) {
      setTargetingError('Select at least 1 industry and 1 city.')
      return
    }

    setTargetingLoading(true)
    setTargetingError('')
    setTargetingSuccess('')

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_targeting', industries: selectedIndustries, cities: selectedCities }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save targeting')
      setTargetingSuccess('Targeting matrix updated.')
      router.refresh()
    } catch (err: unknown) {
      setTargetingError(err instanceof Error ? err.message : 'Save error')
    } finally {
      setTargetingLoading(false)
    }
  }

  const handleAddCustomNiche = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!customLabel || !customCity) return

    setCustomLoading(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add_custom_niche', label: customLabel, city: customCity }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to add custom niche')
      setCustomLabel('')
      setCustomCity('')
      router.refresh()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Niche registration error')
    } finally {
      setCustomLoading(false)
    }
  }

  const handleAddLead = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!leadName || !leadEmail) return

    setLeadLoading(true)
    setLeadMessage(null)
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add_lead',
          business_name: leadName,
          website: leadWebsite || null,
          email: leadEmail,
          city: leadCity || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to add lead')
      setLeadMessage({
        text: `Prospect "${leadName}" added to queue.`,
        success: true,
      })
      setLeadName('')
      setLeadWebsite('')
      setLeadEmail('')
      setLeadCity('')
      router.refresh()
    } catch (err: unknown) {
      setLeadMessage({
        text: err instanceof Error ? err.message : 'Lead addition failed',
        success: false,
      })
    } finally {
      setLeadLoading(false)
    }
  }

  const copyToClipboard = (text: string, field: 'subject' | 'body') => {
    navigator.clipboard.writeText(text)
    setCopiedField(field)
    setTimeout(() => setCopiedField(null), 2000)
  }

  return (
    <div className="min-h-screen bg-[#141414] text-[#c8c4bc] font-sans selection:bg-[#8b3a2a] selection:text-[#c8c4bc] relative">
      {/* Top Glassmorphic Navigation Bar */}
      <header className="sticky top-0 z-40 bg-[#141414e6] backdrop-blur-md border-b border-[#c8c4bc12]">
        <div className="max-w-[1400px] mx-auto px-6 sm:px-10 py-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#8b3a2a]/20 border border-[#8b3a2a]/60 text-[#c8c4bc] flex items-center justify-center font-mono font-medium text-xs shrink-0">
              BG
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <span className="text-sm font-semibold tracking-tight text-white">
                  Bray-Ghost
                </span>
                <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#1c1c1c] text-[#c8c4bc70] border border-[#c8c4bc15]">
                  Intelligence v3
                </span>
              </div>
              <p className="text-[11px] text-[#c8c4bc70] tracking-normal">
                Lead Intelligence &amp; Cold Outreach Engine
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={() => handleManualRun('discover')}
              disabled={manualRunningAction !== null}
              className="px-3.5 py-1.5 rounded-lg text-xs font-mono text-[#c8c4bc] border border-[#c8c4bc20] hover:border-[#c8c4bc40] hover:bg-[#1f1f1f] transition-all flex items-center gap-2 disabled:opacity-30 disabled:cursor-not-allowed"
              title="Search Google Places for businesses matching targeting pools"
            >
              {manualRunningAction === 'discover' ? (
                <span className="w-3 h-3 border-2 border-[#c8c4bc] border-t-transparent rounded-full animate-spin" />
              ) : (
                <span className="text-[10px] text-[#c8c4bc60]">◈</span>
              )}
              <span>Find Prospects</span>
            </button>

            <button
              type="button"
              onClick={() => handleManualRun('enrich_emails')}
              disabled={manualRunningAction !== null}
              className="px-3.5 py-1.5 rounded-lg text-xs font-mono font-medium text-[#c8c4bc] border border-[#c8a44b50] bg-[#c8a44b15] hover:bg-[#c8a44b25] transition-all flex items-center gap-2 disabled:opacity-30 disabled:cursor-not-allowed"
              title="Deep crawl websites, deobfuscate Cloudflare, parse Schema.org & search snippets to find all business emails"
            >
              {manualRunningAction === 'enrich_emails' ? (
                <span className="w-3 h-3 border-2 border-[#c8a44b] border-t-transparent rounded-full animate-spin" />
              ) : (
                <span className="text-[11px] text-[#c8a44b]"><RefreshCw size={14} /></span>
              )}
              <span>Enrich Emails</span>
            </button>

            <button
              type="button"
              onClick={() => handleManualRun('dry_run')}
              disabled={manualRunningAction !== null}
              className="px-3.5 py-1.5 rounded-lg text-xs font-mono text-[#c8c4bc] border border-[#c8c4bc20] hover:border-[#c8c4bc40] hover:bg-[#1f1f1f] transition-all flex items-center gap-2 disabled:opacity-30 disabled:cursor-not-allowed"
              title="Show what the approved-send worker would do without sending or changing anything"
            >
              {manualRunningAction === 'dry_run' ? (
                <span className="w-3 h-3 border-2 border-[#c8c4bc] border-t-transparent rounded-full animate-spin" />
              ) : (
                <span className="text-[11px] text-[#c8c4bc70]">◎</span>
              )}
              <span>Dry Run</span>
            </button>

            <button
              type="button"
              onClick={() => handleManualRun('send_outreach')}
              disabled={manualRunningAction !== null}
              className="px-3.5 py-1.5 rounded-lg text-xs font-mono font-medium text-[#c8c4bc] border border-[#6dc86d]/40 bg-[#6dc86d]/10 hover:bg-[#6dc86d]/20 transition-all flex items-center gap-2 disabled:opacity-30 disabled:cursor-not-allowed"
              title="Dispatch generated pitches via personal Gmail with human-like 20–40s spacing"
            >
              {manualRunningAction === 'send_outreach' ? (
                <span className="w-3 h-3 border-2 border-[#6dc86d] border-t-transparent rounded-full animate-spin" />
              ) : (
                <span className="text-[11px]"><Send size={14} className="inline mr-1" /></span>
              )}
              <span>Send Approved</span>
            </button>

            <button
              type="button"
              onClick={() => handleManualRun('pipeline')}
              disabled={manualRunningAction !== null}
              className="px-4 py-1.5 rounded-lg text-xs font-mono font-medium bg-[#8b3a2a] hover:bg-[#9e4331] text-[#c8c4bc] transition-all flex items-center gap-2 shadow-sm border border-[#8b3a2a] disabled:opacity-30 disabled:cursor-not-allowed"
              title="Audit websites, discover emails, and generate drafts; only approved drafts can send"
            >
              {manualRunningAction === 'pipeline' ? (
                <span className="w-3 h-3 border-2 border-[#c8c4bc] border-t-transparent rounded-full animate-spin" />
              ) : (
                <span className="text-[9px]">▲</span>
              )}
              <span>Run Pipeline</span>
            </button>

            <div className="flex items-center gap-2 bg-[#1c1c1c] px-3 py-1.5 rounded-full border border-[#c8c4bc15] text-xs font-mono">
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  paused ? 'bg-[#c8c4bc40]' : 'bg-[#8b3a2a] animate-pulse'
                }`}
              />
              <span className="text-[11px] text-[#c8c4bc]">
                {paused ? 'Standby' : 'Live'}
              </span>
              <span className="text-[#c8c4bc20]">|</span>
              <span className="text-[11px] text-[#c8c4bc60] tabular-nums">
                {initialSettings.last_run_at
                  ? mounted
                    ? new Date(initialSettings.last_run_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : '…'
                  : 'Never'}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="max-w-[1400px] mx-auto px-6 sm:px-10 py-8 sm:py-10 space-y-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-3 pb-2">
          <div>
            <h1 className="text-2xl sm:text-3xl font-light text-white tracking-tight">
              Lead Intelligence Engine
            </h1>
            <p className="text-xs sm:text-sm text-[#c8c4bc80] mt-1">
              6-dimensional website audits, opportunity scoring, and angle-targeted pitch dispatch.
            </p>
          </div>
        </div>

        {/* Single Lead Enrichment Feedback Notice */}
        {leadEnrichFeedback && (
          <div className={`border rounded-xl p-4 flex items-start justify-between gap-3 text-xs font-mono ${
            leadEnrichFeedback.success ? 'bg-[#141f14] border-[#6dc86d]/40' : 'bg-[#1f1a14] border-[#c8a44b]/40'
          }`}>
            <div className="flex items-start gap-2.5">
              <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
                leadEnrichFeedback.success ? 'bg-[#6dc86d]' : 'bg-[#c8a44b]'
              }`} />
              <div>
                <p className="font-semibold text-white">Email Scraper Result</p>
                <p className="text-[#c8c4bc] mt-0.5">{leadEnrichFeedback.message}</p>
              </div>
            </div>
            <button
              onClick={() => setLeadEnrichFeedback(null)}
              className="text-[#c8c4bc60] hover:text-white text-xs px-2"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* Error Notice */}
        {manualRunError && (
          <div className="bg-[#1c1414] border border-[#8b3a2a]/60 rounded-xl p-4 flex items-start justify-between gap-3 text-xs font-mono">
            <div className="flex items-start gap-2.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#8b3a2a] mt-1.5 shrink-0" />
              <div>
                <p className="font-semibold text-[#c8c4bc]">Execution Error</p>
                <p className="text-[#c8c4bc80] mt-0.5">{manualRunError}</p>
              </div>
            </div>
            <button
              onClick={() => setManualRunError(null)}
              className="text-[#c8c4bc60] hover:text-[#c8c4bc] text-xs px-2"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* Execution Log */}
        {manualRunLogs && manualRunLogs.length > 0 && (
          <div className="bg-[#181818] border border-[#c8c4bc18] rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between border-b border-[#c8c4bc12] pb-3">
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#8b3a2a] animate-pulse" />
                <h3 className="text-xs font-mono text-[#c8c4bc]">
                  Execution Activity Log
                </h3>
              </div>
              <button
                onClick={() => setManualRunLogs(null)}
                className="text-xs font-mono text-[#c8c4bc60] hover:text-[#c8c4bc]"
              >
                <X size={16} /> Close
              </button>
            </div>
            <div className="bg-[#121212] border border-[#c8c4bc10] text-[#c8c4bc] font-mono text-xs p-4 rounded-lg space-y-1.5 max-h-44 overflow-y-auto">
              {manualRunLogs.map((log, index) => (
                <div key={index} className="leading-relaxed flex items-start gap-2">
                  <span className="text-[#8b3a2a] select-none">›</span>
                  <span>{log}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Interactive Stats Cards Row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {/* 1. Prospect Pool */}
          <button
            type="button"
            onClick={() => {
              setStatsModalType('prospect_pool')
              setStatsModalSearch('')
            }}
            className="bg-[#1a1a1a] border border-[#c8c4bc15] hover:border-[#8b3a2a]/60 hover:bg-[#202020] rounded-xl p-4 flex flex-col justify-between space-y-2 text-left transition-all group cursor-pointer"
            title="Click to view all prospects in the directory"
          >
            <div className="flex items-center justify-between w-full">
              <span className="text-[11px] text-[#c8c4bc70] group-hover:text-[#c8c4bc]">Prospect Pool</span>
              <span className="text-[10px] font-mono text-[#c8c4bc30] group-hover:text-[#8b3a2a]">↗</span>
            </div>
            <span className="text-2xl font-light font-mono text-white tabular-nums">{stats.total}</span>
          </button>

          {/* 2. Audited */}
          <button
            type="button"
            onClick={() => {
              setStatsModalType('audited')
              setStatsModalSearch('')
            }}
            className="bg-[#1a1a1a] border border-[#c8c4bc15] hover:border-[#8b3a2a]/60 hover:bg-[#202020] rounded-xl p-4 flex flex-col justify-between space-y-2 text-left transition-all group cursor-pointer"
            title="Click to view audited leads and 6-dimensional scores"
          >
            <div className="flex items-center justify-between w-full">
              <span className="text-[11px] text-[#c8c4bc70] group-hover:text-[#c8c4bc]">Audited</span>
              <span className="text-[10px] font-mono text-[#c8c4bc30] group-hover:text-[#8b3a2a]">↗</span>
            </div>
            <span className="text-2xl font-light font-mono text-white tabular-nums">{stats.audited_total}</span>
          </button>

          {/* 3. Contact Candidates */}
          <button
            type="button"
            onClick={() => {
              setStatsModalType('ready_to_contact')
              setStatsModalSearch('')
            }}
            className="bg-[#1a1a1a] border border-[#c8c4bc15] hover:border-[#6dc86d]/60 hover:bg-[#202020] rounded-xl p-4 flex flex-col justify-between space-y-2 text-left transition-all group cursor-pointer"
            title="Click to view contact candidates requiring human review"
          >
            <div className="flex items-center justify-between w-full">
              <span className="text-[11px] text-[#c8c4bc70] group-hover:text-[#6dc86d]">Contact Candidates</span>
              <span className="text-[10px] font-mono text-[#c8c4bc30] group-hover:text-[#6dc86d]"><RefreshCw size={14} /></span>
            </div>
            <span className="text-2xl font-light font-mono text-white tabular-nums">{stats.ready_to_contact}</span>
          </button>

          {/* 4. Sent Today */}
          <button
            type="button"
            onClick={() => {
              setStatsModalType('sent_today')
              setStatsModalSearch('')
            }}
            className="bg-[#1a1a1a] border border-[#c8c4bc15] hover:border-[#8b3a2a]/60 hover:bg-[#202020] rounded-xl p-4 flex flex-col justify-between space-y-2 text-left transition-all group cursor-pointer"
            title="Click to inspect emails sent today via Gmail"
          >
            <div className="flex items-center justify-between w-full">
              <span className="text-[11px] text-[#c8c4bc70] group-hover:text-[#c8c4bc]">Sent Today</span>
              <span className="text-[10px] font-mono text-[#c8c4bc30] group-hover:text-[#8b3a2a]">↗</span>
            </div>
            <div>
              <span className="text-2xl font-light font-mono text-white tabular-nums">{stats.sent_today}</span>
              <span className="text-[11px] font-mono text-[#c8c4bc60] ml-1">/ {Math.min(Number(dailyCap) || 10, MAX_INITIAL_SENDS_PER_DAY)}</span>
            </div>
          </button>

          {/* 5. Total Dispatched */}
          <button
            type="button"
            onClick={() => {
              setStatsModalType('total_dispatched')
              setStatsModalSearch('')
            }}
            className="bg-[#1a1a1a] border border-[#c8c4bc15] hover:border-[#8b3a2a]/60 hover:bg-[#202020] rounded-xl p-4 flex flex-col justify-between space-y-2 text-left transition-all group cursor-pointer"
            title="Click to view all dispatched outreach and follow-up sequences"
          >
            <div className="flex items-center justify-between w-full">
              <span className="text-[11px] text-[#c8c4bc70] group-hover:text-[#c8c4bc]">Total Dispatched</span>
              <span className="text-[10px] font-mono text-[#c8c4bc30] group-hover:text-[#8b3a2a]">↗</span>
            </div>
            <span className="text-2xl font-light font-mono text-white tabular-nums">{stats.sent_total}</span>
          </button>

          {/* 6. Replies Received */}
          <button
            type="button"
            onClick={() => {
              setStatsModalType('replies')
              setStatsModalSearch('')
            }}
            className="bg-[#1a1a1a] border border-[#c8c4bc15] hover:border-[#c8a44b]/60 hover:bg-[#202020] rounded-xl p-4 flex flex-col justify-between space-y-2 text-left transition-all group cursor-pointer"
            title="Click to view responding leads and log new client replies"
          >
            <div className="flex items-center justify-between w-full">
              <span className="text-[11px] text-[#c8c4bc70] group-hover:text-[#c8a44b]">Replies</span>
              <span className="text-[10px] font-mono text-[#c8a44b] font-medium">+1 Log</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-light font-mono text-white tabular-nums">{stats.replies_total || 0}</span>
              <span className="text-[10px] font-mono text-[#c8a44b]">replied</span>
            </div>
          </button>
        </div>

        {/* Avg Scores Row */}
        {stats.audited_total > 0 && (
          <div className="flex flex-wrap gap-4 text-[11px] font-mono text-[#c8c4bc70]">
            <span>Avg Opportunity: <strong className="text-[#c8c4bc]">{stats.avg_opportunity}</strong></span>
            <span>Avg SEO: <strong className="text-[#c8c4bc]">{stats.avg_seo}</strong></span>
            <span>Avg Mobile: <strong className="text-[#c8c4bc]">{stats.avg_mobile}</strong></span>
          </div>
        )}

        <div className="bg-[#1a1a1a] border border-[#c8c4bc15] rounded-xl p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-xs font-semibold text-white">Commercial Validation Scorecard</h3>
              <p className="text-[11px] text-[#c8c4bc60] mt-1">Evidence toward the first paid pilot. Record every real interaction from the Intel view.</p>
            </div>
            <span className="text-[10px] font-mono text-[#c8a44b]">Target: 30 prospects · 10 conversations · 3 walkthroughs · 1 pilot</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              ['Prospects', stats.total, 30],
              ['Conversations', stats.conversations, 10],
              ['Walkthroughs', stats.walkthroughs, 3],
              ['Paid pilots', stats.paid_pilots, 1],
            ].map(([label, value, target]) => (
              <div key={String(label)} className="bg-[#141414] border border-[#c8c4bc12] rounded-lg p-3">
                <div className="text-[10px] text-[#c8c4bc55]">{label}</div>
                <div className="flex items-baseline gap-1.5 mt-1">
                  <span className="text-xl font-mono text-white">{value}</span>
                  <span className="text-[10px] font-mono text-[#c8c4bc45]">/ {target}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-3 mt-3 text-[10px] font-mono text-[#c8c4bc55]">
            <span>Proposals: <strong className="text-[#c8c4bc]">{stats.proposals}</strong></span>
            <span>Recorded interactions: <strong className="text-[#c8c4bc]">{initialInteractions.length}</strong></span>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="border-b border-[#c8c4bc12]">
          <nav className="-mb-px flex gap-6 overflow-x-auto no-scrollbar">
            {(['leads', 'targeting', 'settings', 'errors'] as const).map((tab) => {
              const labels: Record<string, string> = {
                leads: 'Prospects Directory',
                targeting: 'Targeting Matrix',
                settings: 'Pipeline Settings',
                errors: 'Error Log',
              }
              const counts: Record<string, number> = {
                leads: initialLeads.length,
                targeting: initialNiches.length,
                errors: initialErrors.length,
              }
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`py-3 border-b-2 font-mono text-xs transition-all flex items-center gap-2 shrink-0 whitespace-nowrap ${
                    activeTab === tab
                      ? 'border-[#8b3a2a] text-white font-medium'
                      : 'border-transparent text-[#c8c4bc70] hover:text-[#c8c4bc]'
                  }`}
                >
                  <span>{labels[tab]}</span>
                  {counts[tab] !== undefined && (
                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#1f1f1f] text-[#c8c4bc70]">
                      {counts[tab]}
                    </span>
                  )}
                </button>
              )
            })}
          </nav>
        </div>

        {/* TAB 1: PROSPECTS DIRECTORY */}
        {activeTab === 'leads' && (
          <div className="space-y-6">
            {/* Add Single Prospect */}
            <div className="bg-[#1a1a1a] border border-[#c8c4bc15] rounded-xl p-5 space-y-4">
              <div>
                <h3 className="text-xs font-semibold text-white">Add Single Prospect</h3>
                <p className="text-xs text-[#c8c4bc70] mt-0.5">
                  Directly queue a business for 6-dimensional audit and pitch generation.
                </p>
              </div>

              {leadMessage && (
                <div
                  className={`text-xs font-mono px-3.5 py-2.5 rounded-lg border ${
                    leadMessage.success
                      ? 'bg-[#141414] text-[#c8c4bc] border-[#c8c4bc30]'
                      : 'bg-[#8b3a2a1a] text-[#c8c4bc] border-[#8b3a2a]'
                  }`}
                >
                  {leadMessage.text}
                </div>
              )}

              <form onSubmit={handleAddLead} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                <div>
                  <label className="text-[11px] text-[#c8c4bc70] block mb-1">Business Name *</label>
                  <input type="text" placeholder="e.g. Apex Plumbing" value={leadName} onChange={(e) => setLeadName(e.target.value)}
                    className="w-full px-3 py-1.5 bg-[#141414] border border-[#c8c4bc20] rounded-lg text-xs text-[#c8c4bc] placeholder-[#c8c4bc35] focus:outline-none focus:border-[#8b3a2a]" required />
                </div>
                <div>
                  <label className="text-[11px] text-[#c8c4bc70] block mb-1">Email Address *</label>
                  <input type="email" placeholder="e.g. contact@apex.com" value={leadEmail} onChange={(e) => setLeadEmail(e.target.value)}
                    className="w-full px-3 py-1.5 bg-[#141414] border border-[#c8c4bc20] rounded-lg text-xs text-[#c8c4bc] placeholder-[#c8c4bc35] focus:outline-none focus:border-[#8b3a2a]" required />
                </div>
                <div>
                  <label className="text-[11px] text-[#c8c4bc70] block mb-1">Website URL</label>
                  <input type="text" placeholder="e.g. apexplumbing.com" value={leadWebsite} onChange={(e) => setLeadWebsite(e.target.value)}
                    className="w-full px-3 py-1.5 bg-[#141414] border border-[#c8c4bc20] rounded-lg text-xs text-[#c8c4bc] placeholder-[#c8c4bc35] focus:outline-none focus:border-[#8b3a2a]" />
                </div>
                <div>
                  <label className="text-[11px] text-[#c8c4bc70] block mb-1">City / State</label>
                  <input type="text" placeholder="e.g. Dallas, TX" value={leadCity} onChange={(e) => setLeadCity(e.target.value)}
                    className="w-full px-3 py-1.5 bg-[#141414] border border-[#c8c4bc20] rounded-lg text-xs text-[#c8c4bc] placeholder-[#c8c4bc35] focus:outline-none focus:border-[#8b3a2a]" />
                </div>
                <div className="flex items-end">
                  <button type="submit" disabled={leadLoading || !leadName || !leadEmail}
                    className="w-full py-1.5 px-4 rounded-lg text-xs font-medium bg-[#8b3a2a] hover:bg-[#9e4331] text-[#c8c4bc] transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-1.5">
                    {leadLoading ? <span className="w-3 h-3 border-2 border-[#c8c4bc] border-t-transparent rounded-full animate-spin" /> : <span>+</span>}
                    <span>Add to Queue</span>
                  </button>
                </div>
              </form>
            </div>

            {/* Filter Bar & Prospects Table */}
            <div className="bg-[#1a1a1a] border border-[#c8c4bc15] rounded-xl overflow-hidden space-y-0">
              {/* Bulk Actions Banner (appears when 1+ rows selected) */}
              {selectedLeadIds.length > 0 && (
                <div className="bg-[#8b3a2a]/20 border-b border-[#8b3a2a]/40 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
                  <div className="flex items-center gap-2 text-white">
                    <span className="w-2 h-2 rounded-full bg-[#8b3a2a] animate-pulse" />
                    <span><strong>{selectedLeadIds.length}</strong> lead{selectedLeadIds.length > 1 ? 's' : ''} selected</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleBulkSend}
                      disabled={bulkActionLoading}
                      className="px-3 py-1 bg-[#6dc86d]/10 hover:bg-[#6dc86d]/20 text-[#6dc86d] border border-[#6dc86d]/30 rounded-md transition-all flex items-center gap-1.5 disabled:opacity-40"
                      title="Approve generated drafts for selected leads"
                    >
                      <Send size={14} />
                      <span>Send Outreach Selected ({selectedLeadIds.length})</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleBulkReaudit}
                      disabled={bulkActionLoading}
                      className="px-3 py-1 bg-white/5 hover:bg-white/10 text-[#c8c4bc] border border-white/10 rounded-md border border-[#c8c4bc25] transition-all flex items-center gap-1.5 disabled:opacity-40"
                    >
                      <RefreshCw size={14} />
                      <span>Re-Audit Selected</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleBulkDelete}
                      disabled={bulkActionLoading}
                      className="px-3 py-1 bg-[#8b3a2a]/10 hover:bg-[#8b3a2a]/20 text-[#8b3a2a] border border-[#8b3a2a]/30 rounded-md transition-all flex items-center gap-1.5 disabled:opacity-40"
                    >
                      <span><Trash2 size={14} /></span>
                      <span>Delete Selected</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedLeadIds([])}
                      className="px-2 py-1 text-[#c8c4bc60] hover:text-white transition-colors"
                    >
                      Deselect All
                    </button>
                  </div>
                </div>
              )}

              {/* Status Filter Tabs & Search / Clear Controls */}
              <div className="p-4 border-b border-[#c8c4bc12] flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-1.5 w-full md:w-auto">
                  {LEAD_STATUS_TABS.map((st) => {
                    const count = st === 'all' ? stats.total : statusCounts[st] || 0
                    return (
                      <button
                        key={st}
                        onClick={() => applyStatusFilter(st)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-mono capitalize transition-all flex items-center gap-1.5 ${
                          statusFilter === st
                            ? 'bg-[#8b3a2a] text-[#c8c4bc] font-medium'
                            : 'text-[#c8c4bc70] hover:text-[#c8c4bc] hover:bg-[#222]'
                        }`}
                      >
                        <span>{st.replace('_', ' ')}</span>
                        <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                          statusFilter === st ? 'bg-[#141414]/40 text-[#c8c4bc]' : 'bg-[#141414] text-[#c8c4bc60]'
                        }`}>{count}</span>
                      </button>
                    )
                  })}
                </div>
                <div className="flex items-center gap-2 w-full md:w-auto">
                  <div className="w-full md:w-64">
                    <input
                      type="text"
                      placeholder="Search name, email, website..."
                      value={searchQuery}
                      onChange={(e) => applySearchQuery(e.target.value)}
                      className="w-full px-3.5 py-1.5 bg-[#141414] border border-[#c8c4bc20] rounded-lg text-xs text-[#c8c4bc] placeholder-[#c8c4bc35] focus:outline-none focus:border-[#8b3a2a]"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsClearModalOpen(true)}
                    className="px-3 py-1.5 bg-[#1c1c1c] hover:bg-[#282828] text-[#c8c4bc80] hover:text-[#e85d4a] border border-[#c8c4bc15] hover:border-[#e85d4a]/40 rounded-lg text-xs font-mono transition-all shrink-0 flex items-center gap-1.5"
                    title="Clean old test leads and optionally reset suppressions"
                  >
                    <span><Trash2 size={14} /></span>
                    <span className="hidden sm:inline">Clear Data</span>
                  </button>
                </div>
              </div>

              {/* Data Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#161616] border-b border-[#c8c4bc12] text-[#c8c4bc70] font-mono text-[11px]">
                    <tr>
                      <th className="px-3 py-3 w-10 text-center">
                        <input
                          type="checkbox"
                          checked={pagedLeads.length > 0 && pagedLeads.every((l) => selectedLeadIds.includes(l.id))}
                          onChange={() => handleToggleSelectAll(pagedLeads.map((l) => l.id))}
                          className="rounded border-[#c8c4bc30] bg-[#141414] text-[#8b3a2a] focus:ring-0 cursor-pointer"
                          aria-label="Select all visible leads"
                        />
                      </th>
                      <th className="px-4 py-3 font-normal">Business</th>
                      <th className="px-4 py-3 font-normal">Status</th>
                      <th className="px-4 py-3 font-normal">Lead score</th>
                      <th className="px-4 py-3 font-normal">SEO</th>
                      <th className="px-4 py-3 font-normal">Mobile</th>
                      <th className="px-4 py-3 font-normal">Design</th>
                      <th className="px-4 py-3 font-normal">Angle</th>
                      <th className="px-4 py-3 font-normal">Pitch</th>
                      <th className="px-4 py-3 font-normal">Contact</th>
                      <th className="px-4 py-3 font-normal text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#c8c4bc0a] bg-[#1a1a1a]">
                    {filteredLeads.length === 0 ? (
                      <tr>
                        <td colSpan={11} className="px-6 py-12 text-center text-[#c8c4bc60]">
                          <p className="text-sm font-light text-[#c8c4bc80]">No prospects found</p>
                          <p className="text-xs text-[#c8c4bc50] mt-0.5">
                            Add a prospect above or use &quot;Find Prospects&quot; to discover new businesses.
                          </p>
                        </td>
                      </tr>
                    ) : (
                      pagedLeads.map((lead) => {
                        const isSelected = selectedLeadIds.includes(lead.id)
                        return (
                          <tr
                            key={lead.id}
                            className={`transition-colors ${
                              isSelected ? 'bg-[#8b3a2a]/10 hover:bg-[#8b3a2a]/15' : 'hover:bg-[#202020]'
                            }`}
                          >
                            <td className="px-3 py-3 text-center">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => handleToggleSelectLead(lead.id)}
                                className="rounded border-[#c8c4bc30] bg-[#141414] text-[#8b3a2a] focus:ring-0 cursor-pointer"
                                aria-label={`Select ${lead.business_name}`}
                              />
                            </td>
                            <td className="px-4 py-3">
                              <div className="font-medium text-white truncate max-w-[180px]" title={lead.business_name}>
                                {lead.business_name}
                              </div>
                              {lead.address && (
                                <div className="text-[11px] text-[#c8c4bc60] mt-0.5 truncate max-w-[180px]">{lead.address}</div>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-mono capitalize ${
                                lead.status === 'sent' || lead.status === 'followed_up'
                                  ? 'text-[#c8c4bc] bg-[#8b3a2a]/20'
                                  : lead.status === 'failed'
                                  ? 'text-[#8b3a2a] bg-[#8b3a2a]/10'
                                  : lead.status === 'send_uncertain'
                                  ? 'text-[#e85d4a] bg-[#e85d4a]/10'
                                  : lead.status === 'email_needed'
                                  ? 'text-[#c8a44b] bg-[#c8a44b10]'
                                  : lead.status === 'generated' || lead.status === 'scraped'
                                  ? 'text-[#c8c4bc] bg-[#c8c4bc]/10'
                                  : 'text-[#c8c4bc60]'
                                }`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${
                                  lead.status === 'sent' || lead.status === 'followed_up' ? 'bg-[#8b3a2a]'
                                  : lead.status === 'failed' ? 'bg-[#8b3a2a]'
                                  : lead.status === 'send_uncertain' ? 'bg-[#e85d4a]'
                                  : lead.status === 'email_needed' ? 'bg-[#c8a44b]'
                                  : lead.status === 'generated' || lead.status === 'scraped' ? 'bg-[#c8c4bc]'
                                  : 'bg-[#c8c4bc40]'
                                }`} />
                                {lead.status.replace('_', ' ')}
                              </span>
                              {lead.status === 'generated' && (
                                <div className={`text-[10px] mt-1 font-mono ${
                                  lead.initial_approval_status === 'approved' ? 'text-[#6dc86d]' : 'text-[#c8a44b]'
                                }`}>
                                  {lead.initial_approval_status === 'approved' ? 'approved to send' : 'awaiting approval'}
                                </div>
                              )}
                              {lead.initial_sent_at && !lead.followup_sent_at && lead.followup_body && (
                                <div className={`text-[10px] mt-1 font-mono ${
                                  lead.followup_approval_status === 'approved' ? 'text-[#6dc86d]' : 'text-[#c8a44b]'
                                }`}>
                                  {lead.followup_approval_status === 'approved' ? 'follow-up approved' : 'follow-up awaiting approval'}
                                </div>
                              )}
                              <div className="text-[10px] text-[#c8c4bc45] mt-1 whitespace-nowrap">{getLeadNextAction(lead)}</div>
                            </td>
                            <td className="px-4 py-3"><OpportunityBadge score={lead.opportunity_score} /></td>
                            <td className="px-4 py-3"><ScorePill score={lead.seo_score} /></td>
                            <td className="px-4 py-3"><ScorePill score={lead.mobile_score} /></td>
                            <td className="px-4 py-3"><ScorePill score={lead.design_score} /></td>
                            <td className="px-4 py-3"><AnglePill angle={lead.outreach_angle} /></td>
                            <td className="px-4 py-3">
                              {lead.generated_body ? (
                                <button
                                  type="button"
                                  onClick={() => setExpandedLeadId(lead.id)}
                                  className="text-[11px] font-mono text-[#c8a44b] hover:text-white hover:underline whitespace-nowrap"
                                  title="Open the pitch preview before sending"
                                >
                                  Review pitch
                                </button>
                              ) : (
                                <span className="text-[11px] font-mono text-[#c8c4bc35]">Not ready</span>
                              )}
                            </td>
                            <td className="px-4 py-3 font-mono text-[#c8c4bc] truncate max-w-[150px]">
                              {lead.email ? (
                                <div className="flex flex-col gap-0.5">
                                  <div className="flex items-center gap-1.5">
                                    <ConfidenceDot confidence={lead.email_confidence} />
                                    <a href={`mailto:${lead.email}`} className="hover:underline truncate text-[11px] text-[#e0ded8]">{lead.email}</a>
                                  </div>
                                  {lead.email_source_url && (
                                    <a
                                      href={lead.email_source_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-[10px] text-[#c8c4bc45] hover:text-[#c8a44b] hover:underline truncate max-w-[150px]"
                                      title={`Evidence source: ${lead.email_source_url}`}
                                    >
                                      Evidence · {lead.email_source || 'website'}
                                    </a>
                                  )}
                                </div>
                              ) : (
                                <span className="text-[#c8c4bc40] text-[11px] italic">{lead.website ? 'No public email' : 'No website/email'}</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  onClick={() => setExpandedLeadId(lead.id)}
                                  className="px-2.5 py-1 rounded-md text-[11px] font-mono text-[#c8c4bc] border border-[#c8c4bc20] hover:border-[#8b3a2a] hover:bg-[#222] transition-colors"
                                  title="View audit scores, verified facts, and AI pitch"
                                >
                                  Intel
                                </button>
                                {lead.email && lead.generated_body && !lead.initial_sent_at ? (
                                  <button
                                    type="button"
                                    onClick={() => handleSendSingle(lead.id, lead.initial_approval_status === 'approved')}
                                    disabled={sendingLeadId === lead.id}
                                    className="p-1 rounded-md text-[11px] font-mono text-[#6dc86d] border border-[#6dc86d]/30 hover:bg-[#6dc86d]/20 transition-all disabled:opacity-40"
                                    title={lead.initial_approval_status === 'approved' ? 'Revoke approval' : 'Approve this generated draft for sending'}
                                  >
                                    {sendingLeadId === lead.id ? (
                                      <span className="w-3.5 h-3.5 border-2 border-[#6dc86d] border-t-transparent rounded-full animate-spin inline-block" />
                                    ) : (
                                      <Send size={14} />
                                    )}
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => handleEnrichSingle(lead.id)}
                                    disabled={enrichingSingleId === lead.id}
                                    className="p-1 rounded-md text-[11px] font-mono text-[#c8a44b] border border-[#c8a44b]/30 hover:bg-[#c8a44b]/20 transition-all disabled:opacity-40"
                                    title="Find Email via Search Engines"
                                  >
                                    {enrichingSingleId === lead.id ? (
                                      <span className="w-3.5 h-3.5 border-2 border-[#c8a44b] border-t-transparent rounded-full animate-spin inline-block" />
                                    ) : (
                                      <Zap size={14} />
                                    )}
                                  </button>
                                )}
                                <button
                                  onClick={() => handleReauditLead(lead.id)}
                                  disabled={reauditingLeadId === lead.id}
                                  className="p-1 rounded-md text-[11px] font-mono text-[#c8c4bc70] border border-[#c8c4bc15] hover:text-white hover:border-[#c8a44b] hover:bg-[#c8a44b]/10 transition-all disabled:opacity-40"
                                  title="Re-run 6D audit & PageSpeed insights"
                                >
                                  {reauditingLeadId === lead.id ? (
                                    <span className="w-3 h-3 border-2 border-[#c8a44b] border-t-transparent rounded-full animate-spin inline-block" />
                                  ) : (
                                    <RefreshCw size={14} />
                                  )}
                                </button>
                                <button
                                  onClick={() => handleOpenEdit(lead)}
                                  className="p-1 rounded-md text-[11px] text-[#c8c4bc70] border border-[#c8c4bc15] hover:text-white hover:border-[#c8c4bc40] hover:bg-[#222] transition-colors"
                                  title="Edit lead details"
                                >
                                  <Edit2 size={14} />
                                </button>
                                <button
                                  onClick={() => handleDeleteLead(lead.id, lead.business_name)}
                                  disabled={deletingLeadId === lead.id}
                                  className="p-1 rounded-md text-[11px] text-[#c8c4bc60] border border-[#c8c4bc15] hover:text-[#e85d4a] hover:border-[#e85d4a]/40 hover:bg-[#8b3a2a]/10 transition-colors disabled:opacity-40"
                                  title="Delete lead"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <PaginationControls
                page={currentLeadsPage}
                pageSize={leadsPageSize}
                total={filteredLeads.length}
                onPageChange={setLeadsPage}
                onPageSizeChange={(size) => {
                  setLeadsPageSize(size)
                  setLeadsPage(1)
                }}
              />
            </div>
          </div>
        )}

        {/* TAB 2: TARGETING MATRIX */}
        {activeTab === 'targeting' && (
          <div className="space-y-6">
            <div className="bg-[#1a1a1a] border border-[#c8c4bc15] rounded-xl p-6 space-y-6">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-[#c8c4bc12] pb-4">
                <div>
                  <h3 className="text-sm font-medium text-white">Targeting Pools</h3>
                  <p className="text-xs text-[#c8c4bc70] mt-0.5">Select industries and metro locations for autonomous discovery (minimum 1 of each).</p>
                </div>
                <div className="px-3 py-1 bg-[#141414] border border-[#c8c4bc15] rounded-md font-mono text-xs text-[#c8c4bc]">
                  {selectedIndustries.length} × {selectedCities.length} = {selectedIndustries.length * selectedCities.length} Pools
                </div>
              </div>
              {targetingError && <div className="text-xs font-mono text-[#c8c4bc] bg-[#8b3a2a1a] border border-[#8b3a2a] p-3 rounded-lg">{targetingError}</div>}
              {targetingSuccess && <div className="text-xs font-mono text-[#c8c4bc] bg-[#141414] border border-[#c8c4bc30] p-3 rounded-lg">{targetingSuccess}</div>}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <h4 className="text-xs text-[#c8c4bc70] uppercase font-mono tracking-wider">Industries ({selectedIndustries.length} selected)</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {defaultIndustries.map((ind) => {
                      const isSelected = selectedIndustries.includes(ind)
                      return (
                        <button key={ind} type="button" onClick={() => handleToggleIndustry(ind)}
                          className={`p-2.5 rounded-lg text-left text-xs transition-all flex items-center justify-between border ${
                            isSelected ? 'bg-[#8b3a2a]/15 border-[#8b3a2a]/60 text-white' : 'bg-[#161616] border-[#c8c4bc10] text-[#c8c4bc70] hover:text-[#c8c4bc] hover:border-[#c8c4bc25]'
                          }`}>
                          <span>{ind}</span>
                          <span className={`w-3.5 h-3.5 rounded flex items-center justify-center text-[9px] border ${
                            isSelected ? 'bg-[#8b3a2a] border-[#8b3a2a] text-white font-bold' : 'border-[#c8c4bc20]'
                          }`}>{isSelected ? '' : ''}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
                <div className="space-y-3">
                  <h4 className="text-xs text-[#c8c4bc70] uppercase font-mono tracking-wider">Metros ({selectedCities.length} selected)</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {defaultCities.map((city) => {
                      const isSelected = selectedCities.includes(city)
                      return (
                        <button key={city} type="button" onClick={() => handleToggleCity(city)}
                          className={`p-2.5 rounded-lg text-left text-xs transition-all flex items-center justify-between border ${
                            isSelected ? 'bg-[#8b3a2a]/15 border-[#8b3a2a]/60 text-white' : 'bg-[#161616] border-[#c8c4bc10] text-[#c8c4bc70] hover:text-[#c8c4bc] hover:border-[#c8c4bc25]'
                          }`}>
                          <span>{city}</span>
                          <span className={`w-3.5 h-3.5 rounded flex items-center justify-center text-[9px] border ${
                            isSelected ? 'bg-[#8b3a2a] border-[#8b3a2a] text-white font-bold' : 'border-[#c8c4bc20]'
                          }`}>{isSelected ? '' : ''}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
              <div className="flex justify-end pt-2 border-t border-[#c8c4bc12]">
                <button type="button" onClick={handleSaveTargeting} disabled={targetingLoading}
                  className="px-5 py-2 rounded-lg text-xs font-medium bg-[#8b3a2a] hover:bg-[#9e4331] text-[#c8c4bc] transition-all disabled:opacity-30">
                  {targetingLoading ? 'Saving...' : 'Save Targeting Pools'}
                </button>
              </div>
            </div>
            <div className="bg-[#1a1a1a] border border-[#c8c4bc15] rounded-xl p-5 space-y-3">
              <h4 className="text-xs font-medium text-white">Add Custom Niche / Metro</h4>
              <form onSubmit={handleAddCustomNiche} className="flex flex-wrap gap-3">
                <input type="text" placeholder="Industry (e.g. Solar Installation)" value={customLabel} onChange={(e) => setCustomLabel(e.target.value)}
                  className="flex-1 min-w-[200px] px-3.5 py-1.5 bg-[#141414] border border-[#c8c4bc20] rounded-lg text-xs text-[#c8c4bc] placeholder-[#c8c4bc35] focus:outline-none focus:border-[#8b3a2a]" required />
                <input type="text" placeholder="Metro (e.g. San Diego, CA)" value={customCity} onChange={(e) => setCustomCity(e.target.value)}
                  className="flex-1 min-w-[200px] px-3.5 py-1.5 bg-[#141414] border border-[#c8c4bc20] rounded-lg text-xs text-[#c8c4bc] placeholder-[#c8c4bc35] focus:outline-none focus:border-[#8b3a2a]" required />
                <button type="submit" disabled={customLoading || !customLabel || !customCity}
                  className="px-4 py-1.5 bg-[#1f1f1f] hover:bg-[#282828] text-[#c8c4bc] rounded-lg text-xs border border-[#c8c4bc20] disabled:opacity-30">
                  {customLoading ? 'Adding...' : '+ Add Niche'}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* TAB 3: PIPELINE SETTINGS */}
        {activeTab === 'settings' && (
          <div className="bg-[#1a1a1a] border border-[#c8c4bc15] rounded-xl p-6 space-y-6 max-w-xl">
            <div className="border-b border-[#c8c4bc12] pb-4">
              <h3 className="text-sm font-medium text-white">Pipeline Dispatch Controls</h3>
              <p className="text-xs text-[#c8c4bc70] mt-0.5">Configure sending volumes, Gmail integration, and emergency controls.</p>
            </div>
            <div className="p-4 bg-[#141414] border border-[#c8c4bc15] rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-medium text-white">Gmail Integration</h4>
                  <p className="text-[11px] text-[#c8c4bc60] mt-0.5">Connect your Gmail account to dispatch cold outreach pitches.</p>
                </div>
                {initialSettings?.gmail_user ? (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono bg-[#8b3a2a]/20 text-[#c8c4bc] border border-[#8b3a2a]/40">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#8b3a2a]" />Connected
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono bg-[#222] text-[#c8c4bc60]">Not Connected</span>
                )}
              </div>
              {initialSettings?.gmail_user ? (
                <div className="text-xs font-mono text-[#c8c4bc80] flex items-center justify-between pt-1">
                  <span>Account: <strong className="text-[#c8c4bc] font-normal">{initialSettings.gmail_user}</strong></span>
                  <a href="/api/auth/google" className="text-[11px] text-[#c8c4bc] underline hover:text-white">Reconnect</a>
                </div>
              ) : (
                <div className="pt-1">
                  <a href="/api/auth/google" className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium bg-[#8b3a2a] hover:bg-[#9e4331] text-[#c8c4bc] transition-all">
                    <span>Connect Gmail via Google OAuth</span><span>→</span>
                  </a>
                </div>
              )}
            </div>
            {settingsMessage && <div className="text-xs font-mono text-[#c8c4bc] bg-[#141414] border border-[#c8c4bc30] p-3 rounded-lg">{settingsMessage}</div>}
            <form onSubmit={handleUpdateSettings} className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-xs font-mono text-[#c8c4bc] block">Daily Initial Send Cap (1–{MAX_DAILY_CAP})</label>
                <input type="number" min={1} max={MAX_DAILY_CAP} value={dailyCap ?? ''}
                  onChange={(e) => {
                    const val = e.target.value
                    if (val === '') setDailyCap('')
                    else { const parsed = parseInt(val, 10); setDailyCap(isNaN(parsed) ? '' : parsed) }
                  }}
                  className="w-32 px-3 py-1.5 bg-[#141414] border border-[#c8c4bc20] rounded-lg text-sm font-mono text-[#c8c4bc] focus:outline-none focus:border-[#8b3a2a]" />
                <p className="text-[11px] text-[#c8c4bc60]">Initial sends are capped at max 50/day. Follow-up sequences run on their own separate 50/day allocation.</p>
              </div>
              <div className="pt-2 border-t border-[#c8c4bc12]">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)}
                    className="w-4 h-4 rounded bg-[#141414] border-[#c8c4bc30] text-[#8b3a2a] focus:ring-0 cursor-pointer" />
                  <div>
                    <p className="text-xs font-medium text-white">Emergency Pipeline Pause</p>
                    <p className="text-[11px] text-[#c8c4bc60]">When enabled, all auditing, AI generation, and email transmissions are instantly paused.</p>
                  </div>
                </label>
              </div>
              <div className="pt-2">
                <button type="submit" disabled={settingsLoading}
                  className="px-5 py-2 rounded-lg text-xs font-medium bg-[#8b3a2a] hover:bg-[#9e4331] text-[#c8c4bc] transition-all disabled:opacity-30">
                  {settingsLoading ? 'Saving...' : 'Save Settings'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* TAB 4: ERROR LOG */}
        {activeTab === 'errors' && (
          <div className="bg-[#1a1a1a] border border-[#c8c4bc15] rounded-xl overflow-hidden">
            <div className="p-4 border-b border-[#c8c4bc12] flex justify-between items-center bg-[#181818]">
              <div>
                <h3 className="text-xs font-mono text-white">Stage Execution Error Log</h3>
                <p className="text-[11px] text-[#c8c4bc70] mt-0.5">Logged exceptions from discovery and pipeline background jobs.</p>
              </div>
              <span className="text-xs font-mono text-[#c8c4bc60]">{initialErrors.length} total</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#161616] text-[#c8c4bc70] font-mono text-[11px] border-b border-[#c8c4bc12]">
                  <tr>
                    <th className="px-6 py-3 font-normal">Source / Stage</th>
                    <th className="px-6 py-3 font-normal">Message</th>
                    <th className="px-6 py-3 font-normal">Timestamp</th>
                    <th className="px-6 py-3 font-normal">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#c8c4bc0a] font-mono text-[11px] bg-[#1a1a1a]">
                  {initialErrors.length === 0 ? (
                    <tr><td colSpan={4} className="px-6 py-10 text-center text-[#c8c4bc60] font-sans">No errors recorded. All pipeline stages operating normally.</td></tr>
                  ) : (
                    pagedErrors.map((err) => (
                      <tr key={err.id} className="hover:bg-[#202020]">
                        <td className="px-6 py-3.5 text-[#c8c4bc]">
                          <span className="text-[#8b3a2a] font-medium">{err.source}</span>
                          <span className="text-[#c8c4bc40] mx-1">/</span>
                          <span>{err.stage}</span>
                        </td>
                        <td className="px-6 py-3.5 text-[#c8c4bc80] max-w-md truncate" title={err.message}>{err.message}</td>
                        <td className="px-6 py-3.5 text-[#c8c4bc60] tabular-nums text-[11px]">
                          {mounted ? new Date(err.created_at).toLocaleString() : '…'}
                        </td>
                        <td className="px-6 py-3.5">
                          <button onClick={() => setExpandedErrorId(err.id)} className="text-[#c8c4bc] hover:underline text-[11px]">Details</button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <PaginationControls page={currentErrorsPage} pageSize={errorsPageSize} total={initialErrors.length}
              onPageChange={setErrorsPage} onPageSizeChange={(size) => { setErrorsPageSize(size); setErrorsPage(1) }} />
          </div>
        )}
      </main>

      {/* LEAD INTELLIGENCE PROFILE MODAL */}
      {isEmailModalOpen && selectedLead && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm cursor-pointer"
          onClick={(e) => {
            if (e.target === e.currentTarget) setExpandedLeadId(null)
          }}
        >
          <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true"
            className="bg-[#1c1c1c] border border-[#c8c4bc20] rounded-xl max-w-3xl w-full p-6 space-y-5 shadow-2xl focus:outline-none max-h-[90vh] overflow-y-auto cursor-default">
            <div className="flex justify-between items-start border-b border-[#c8c4bc12] pb-4">
              <div>
                <h3 className="text-base font-medium text-white">{selectedLead.business_name}</h3>
                <div className="flex flex-wrap items-center gap-3 mt-1.5">
                  {selectedLead.website && (
                    <a
                      href={selectedLead.website.startsWith('http') ? selectedLead.website : `https://${selectedLead.website}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-mono text-[#c8a44b] hover:underline flex items-center gap-1"
                    >
                      <span><Globe size={14} /></span>
                      <span className="truncate max-w-xs">{selectedLead.website}</span>
                    </a>
                  )}
                  {selectedLead.email && (
                    <div className="flex items-center gap-1.5 text-xs font-mono text-[#c8c4bc]">
                      <ConfidenceDot confidence={selectedLead.email_confidence} />
                      <a href={`mailto:${selectedLead.email}`} className="hover:underline text-white font-medium">{selectedLead.email}</a>
                    </div>
                  )}
                  {selectedLead.phone && (
                    <a href={`tel:${selectedLead.phone}`} className="text-xs font-mono text-[#c8c4bc70] hover:underline"><Phone size={12} className="inline mr-1" />{selectedLead.phone}</a>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-3 text-[11px] font-mono">
                  <span className="text-[#c8c4bc45] uppercase tracking-wider">Next action</span>
                  <span className="px-2 py-1 rounded-md bg-[#c8a44b]/10 border border-[#c8a44b]/25 text-[#c8a44b]">{getLeadNextAction(selectedLead)}</span>
                </div>
              </div>
              <button onClick={() => setExpandedLeadId(null)} className="text-[#c8c4bc70] hover:text-white p-1 text-sm" aria-label="Close modal"><X size={14} /></button>
            </div>

            {/* Email Intelligence & Scraper Box */}
            <div className="bg-[#151515] border border-[#c8c4bc18] rounded-xl p-4 space-y-3">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-[#c8a44b20] border border-[#c8a44b40] flex items-center justify-center text-sm">
                    <Zap size={14} className="inline mr-1" />
                  </div>
                  <div>
                    <h4 className="text-xs font-medium text-white">Email Scraper &amp; Enrichment</h4>
                    <p className="text-[11px] text-[#c8c4bc70]">
                      {selectedLead.email
                        ? `Enriched from ${selectedLead.email_source || 'unspecified source'} with ${selectedLead.email_confidence || 'UNKNOWN'} confidence.`
                        : 'No email currently stored. Run deep scraping on website, schema & search graph.'}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleEnrichLead(selectedLead.id)}
                  disabled={enrichingLeadId === selectedLead.id}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-mono font-medium text-[#c8c4bc] bg-[#8b3a2a] hover:bg-[#9e4331] transition-all flex items-center gap-2 disabled:opacity-40"
                >
                  {enrichingLeadId === selectedLead.id ? (
                    <span className="w-3 h-3 border-2 border-[#c8c4bc] border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <span><Search size={14} /></span>
                  )}
                  <span>{selectedLead.email ? 'Re-Scrape & Verify' : 'Scrape Email Now'}</span>
                </button>
              </div>

              {selectedLead.email && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 pt-2 border-t border-[#c8c4bc10] text-[11px] font-mono text-[#c8c4bc70]">
                  <div>
                    <span className="text-[#c8c4bc40]">Confidence: </span>
                    <span className={`font-medium ${selectedLead.email_confidence === 'HIGH' ? 'text-[#6dc86d]' : 'text-[#e8b85d]'}`}>{selectedLead.email_confidence || 'UNKNOWN'}</span>
                  </div>
                  <div>
                    <span className="text-[#c8c4bc40]">Source: </span>
                    <span className="text-white">{selectedLead.email_source || 'unspecified'}</span>
                  </div>
                  <div>
                    <span className="text-[#c8c4bc40]">Verification: </span>
                    <span className={selectedLead.email_verification_status === 'source_verified' ? 'text-[#6dc86d]' : 'text-[#e8b85d]'}>
                      {selectedLead.email_verification_status === 'source_verified'
                        ? 'Published on linked source (delivery not checked)'
                        : selectedLead.email_verification_status === 'needs_review'
                          ? 'Needs source review'
                          : 'No source verification'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[#c8c4bc40]">Lead Status: </span>
                    <span className="text-white capitalize">{selectedLead.status}</span>
                  </div>
                  <div className="min-w-0">
                    <span className="text-[#c8c4bc40]">Evidence: </span>
                    {selectedLead.email_source_url ? (
                      <a href={selectedLead.email_source_url} target="_blank" rel="noopener noreferrer" className="text-[#c8a44b] hover:underline truncate inline-block max-w-full align-bottom" title={selectedLead.email_source_url}>Open source</a>
                    ) : (
                      <span className="text-[#e8b85d]">No linked source — verify manually</span>
                    )}
                  </div>
                </div>
              )}
              {selectedLead.email && selectedLead.email_verification_status !== 'source_verified' && (
                <div className="rounded-md border border-[#e8b85d]/25 bg-[#e8b85d]/5 px-3 py-2 text-[11px] text-[#e8b85d]">
                  Do not contact this address yet. Confirm the recipient on the business&apos;s current website or public business profile before recording or sending an attempt.
                </div>
              )}
            </div>

            {selectedLead.website && (
              <div className="rounded-lg border border-[#c8c4bc15] bg-[#141414] px-3.5 py-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono uppercase tracking-wider text-[#c8c4bc70]">Website audit queue</span>
                  {selectedLead.audit_next_attempt_at ? (
                    <span className="text-[#e8b85d]">Retry queued for {mounted ? new Date(selectedLead.audit_next_attempt_at).toLocaleString() : '…'}</span>
                  ) : selectedLead.audit_attempts >= 3 ? (
                    <span className="text-[#e8b85d]">Automatic retries exhausted; review site and contact route</span>
                  ) : selectedLead.audit_attempts > 0 ? (
                    <span className="text-[#e8b85d]">Previous audit attempt failed; retry is pending</span>
                  ) : selectedLead.last_audited_at ? (
                    <span className="text-[#6dc86d]">Last successful audit {mounted ? new Date(selectedLead.last_audited_at).toLocaleString() : '…'}</span>
                  ) : (
                    <span className="text-[#c8c4bc]">Waiting for website audit</span>
                  )}
                </div>
                {selectedLead.audit_attempts > 0 && (
                  <p className="mt-1.5 text-[#c8c4bc60]">Failed audit attempts: {selectedLead.audit_attempts} of 3. The system will retry automatically when due.</p>
                )}
              </div>
            )}

            {/* Audit Scores Grid */}
            {selectedLead.opportunity_score !== null && (
              <div className="space-y-3">
                <h4 className="text-[11px] font-mono text-[#c8c4bc70] uppercase tracking-wider">Website Intelligence</h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-[#141414] border border-[#c8c4bc15] rounded-lg p-3 text-center">
                    <div className="text-[10px] text-[#c8c4bc60] mb-1">Opportunity</div>
                    <OpportunityBadge score={selectedLead.opportunity_score} />
                  </div>
                  <div className="bg-[#141414] border border-[#c8c4bc15] rounded-lg p-3 text-center">
                    <div className="text-[10px] text-[#c8c4bc60] mb-1">SEO</div>
                    <ScorePill score={selectedLead.seo_score} />
                  </div>
                  <div className="bg-[#141414] border border-[#c8c4bc15] rounded-lg p-3 text-center">
                    <div className="text-[10px] text-[#c8c4bc60] mb-1">Mobile</div>
                    <ScorePill score={selectedLead.mobile_score} />
                  </div>
                  <div className="bg-[#141414] border border-[#c8c4bc15] rounded-lg p-3 text-center">
                    <div className="text-[10px] text-[#c8c4bc60] mb-1">Design</div>
                    <ScorePill score={selectedLead.design_score} />
                  </div>
                  <div className="bg-[#141414] border border-[#c8c4bc15] rounded-lg p-3 text-center">
                    <div className="text-[10px] text-[#c8c4bc60] mb-1">Performance</div>
                    <ScorePill score={selectedLead.performance_score} />
                  </div>
                  <div className="bg-[#141414] border border-[#c8c4bc15] rounded-lg p-3 text-center">
                    <div className="text-[10px] text-[#c8c4bc60] mb-1">UX / Conversion</div>
                    <ScorePill score={selectedLead.ux_score} />
                  </div>
                  <div className="bg-[#141414] border border-[#c8c4bc15] rounded-lg p-3 text-center">
                    <div className="text-[10px] text-[#c8c4bc60] mb-1">Technical</div>
                    <ScorePill score={selectedLead.technical_score} />
                  </div>
                  <div className="bg-[#141414] border border-[#c8c4bc15] rounded-lg p-3 text-center">
                    <div className="text-[10px] text-[#c8c4bc60] mb-1">Outreach Angle</div>
                    <AnglePill angle={selectedLead.outreach_angle} />
                  </div>
                </div>
              </div>
            )}

            {/* Measured page observations with their source and audit time */}
            {selectedLead.audit_details?.verifiedFacts && selectedLead.audit_details.verifiedFacts.length > 0 && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-mono text-[#6dc86d] uppercase tracking-wider font-semibold">
                    Automated Page Observations
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#6dc86d]/10 text-[#6dc86d] border border-[#6dc86d]/20">
                    Measured from checked page
                  </span>
                  {selectedLead.audit_details.sourceUrl && (
                    <a href={selectedLead.audit_details.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] font-mono text-[#c8a44b] hover:underline">
                      Open source page
                    </a>
                  )}
                  {selectedLead.audit_details.observedAt && (
                    <span className="text-[10px] font-mono text-[#c8c4bc50]">
                      Checked {mounted ? new Date(selectedLead.audit_details.observedAt).toLocaleString() : '…'}
                    </span>
                  )}
                </div>
                <div className="bg-[#141414] border border-[#6dc86d]/20 rounded-lg p-3 space-y-1.5">
                  {selectedLead.audit_details.verifiedFacts.map((fact: string, idx: number) => {
                    const evidence = selectedLead.audit_details?.verifiedFactEvidence?.[idx]
                    return (
                      <div key={idx} className="flex items-start gap-2 text-xs font-mono text-[#c8c4bc]">
                        <span className="text-[#6dc86d] text-xs"><CheckCircle2 size={14} /></span>
                        <span className="min-w-0 flex-1">{fact}</span>
                        {evidence?.sourceUrl && (
                          <a href={evidence.sourceUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 text-[10px] text-[#c8a44b] hover:underline">Source</a>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Google PageSpeed Insights Lab Metrics */}
            {selectedLead.audit_details?.pageSpeed && (
              <div className="space-y-2">
                <h4 className="text-[11px] font-mono text-[#c8c4bc70] uppercase tracking-wider">
                  Google PageSpeed Insights (Mobile Lab Data)
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
                  <div className="p-2.5 bg-[#141414] border border-[#c8c4bc12] rounded-lg">
                    <div className="text-[10px] text-[#c8c4bc50]">Lighthouse Score</div>
                    <div className="text-white font-medium mt-0.5">{selectedLead.audit_details.pageSpeed.performanceScore}/100</div>
                  </div>
                  {selectedLead.audit_details.pageSpeed.largestContentfulPaint && (
                    <div className="p-2.5 bg-[#141414] border border-[#c8c4bc12] rounded-lg">
                      <div className="text-[10px] text-[#c8c4bc50]">Largest Contentful Paint</div>
                      <div className="text-white font-medium mt-0.5">{selectedLead.audit_details.pageSpeed.largestContentfulPaint}</div>
                    </div>
                  )}
                  {selectedLead.audit_details.pageSpeed.speedIndex && (
                    <div className="p-2.5 bg-[#141414] border border-[#c8c4bc12] rounded-lg">
                      <div className="text-[10px] text-[#c8c4bc50]">Speed Index</div>
                      <div className="text-white font-medium mt-0.5">{selectedLead.audit_details.pageSpeed.speedIndex}</div>
                    </div>
                  )}
                  {selectedLead.audit_details.pageSpeed.totalBlockingTime && (
                    <div className="p-2.5 bg-[#141414] border border-[#c8c4bc12] rounded-lg">
                      <div className="text-[10px] text-[#c8c4bc50]">Total Blocking Time</div>
                      <div className="text-white font-medium mt-0.5">{selectedLead.audit_details.pageSpeed.totalBlockingTime}</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Outreach Reason & Issues */}
            {selectedLead.outreach_reason && (
              <div className="bg-[#141414] border border-[#c8c4bc15] rounded-lg p-3 space-y-2">
                <div className="text-[10px] font-mono text-[#c8c4bc60] uppercase">Outreach Angle Reasoning</div>
                <p className="text-xs text-[#c8c4bc]">{selectedLead.outreach_reason}</p>
              </div>
            )}

            {selectedLead.audit_details?.verifiedFacts?.[0] && (
              <div className="bg-[#8b3a2a]/10 border border-[#c8a44b]/25 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[10px] font-mono text-[#c8a44b] uppercase">Conversation brief</div>
                  <span className="text-[9px] font-mono text-[#c8c4bc55] uppercase">Verify before sharing</span>
                </div>
                <div className="space-y-1.5 text-xs">
                  <p className="text-[#c8c4bc]"><span className="text-[#c8c4bc55]">Observed: </span>{selectedLead.audit_details.verifiedFacts[0]}</p>
                  <p className="text-[#c8c4bc]"><span className="text-[#c8c4bc55]">Business hypothesis: </span>This may make it less direct for an interested visitor to take the next enquiry step. It is a hypothesis to test, not a measured loss.</p>
                  {selectedLead.audit_details.quickWins?.[0] && (
                    <p className="text-[#c8c4bc]"><span className="text-[#c8c4bc55]">Possible pilot repair: </span>{selectedLead.audit_details.quickWins[0]}</p>
                  )}
                </div>
              </div>
            )}

            {selectedLead.audit_details?.topIssues && selectedLead.audit_details.topIssues.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-[11px] font-mono text-[#c8c4bc70] uppercase tracking-wider">Detected Issues</h4>
                <div className="space-y-1.5">
                  {selectedLead.audit_details.topIssues.map((issue: AuditIssue, idx: number) => (
                    <div key={idx} className="bg-[#141414] border border-[#c8c4bc10] rounded-lg p-2.5 flex gap-2">
                      <span className={`w-2 h-2 rounded-full mt-1 shrink-0 ${
                        issue.severity === 'high' ? 'bg-[#e85d4a]' : issue.severity === 'medium' ? 'bg-[#c8a44b]' : 'bg-[#c8c4bc40]'
                      }`} />
                      <div>
                        <div className="text-[11px] font-medium text-white">{issue.title}</div>
                        <div className="text-[10px] text-[#c8c4bc70] mt-0.5">{issue.detail}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedLead.audit_details?.quickWins && selectedLead.audit_details.quickWins.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-[11px] font-mono text-[#c8c4bc70] uppercase tracking-wider">Quick Wins</h4>
                <ul className="space-y-1">
                  {selectedLead.audit_details.quickWins.map((win: string, idx: number) => (
                    <li key={idx} className="flex items-start gap-2 text-xs text-[#c8c4bc]">
                      <span className="text-[#8b3a2a] text-[10px] mt-0.5"><ChevronRight size={12} /></span>
                      <span>{win}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Generated Pitch */}
            {selectedLead.generated_body && (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-[11px] font-mono text-[#c8a44b] uppercase tracking-wider">Pitch preview</h4>
                    <p className="text-[11px] text-[#c8c4bc55] mt-1">Review the facts, tone, and offer here. Nothing is sent until you choose “Send Now”.</p>
                  </div>
                  <span className="shrink-0 px-2 py-1 rounded-md bg-[#6dc86d]/10 border border-[#6dc86d]/20 text-[#6dc86d] text-[10px] font-mono">Draft</span>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-mono text-[#c8c4bc70]">Subject Line</label>
                    {selectedLead.generated_subject && (
                      <button onClick={() => copyToClipboard(selectedLead.generated_subject || '', 'subject')}
                        className="text-[11px] font-mono text-[#c8c4bc] hover:underline">
                        {copiedField === 'subject' ? 'Copied' : 'Copy'}
                      </button>
                    )}
                  </div>
                  <div className="p-3 bg-[#141414] border border-[#c8c4bc15] rounded-lg text-xs font-mono text-[#c8c4bc]">
                    {selectedLead.generated_subject || 'No subject generated'}
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-mono text-[#c8c4bc70]">Email Body (AI Personalized &amp; Grounded)</label>
                    {selectedLead.generated_body && (
                      <button onClick={() => copyToClipboard(selectedLead.generated_body || '', 'body')}
                        className="text-[11px] font-mono text-[#c8c4bc] hover:underline">
                        {copiedField === 'body' ? 'Copied' : 'Copy'}
                      </button>
                    )}
                  </div>
                  <div className="p-4 bg-[#141414] border border-[#c8c4bc15] rounded-lg text-xs leading-relaxed text-[#c8c4bc] font-mono whitespace-pre-wrap max-h-48 overflow-y-auto">
                    {selectedLead.generated_body || 'No body generated'}
                  </div>
                </div>
                {selectedLead.email && !selectedLead.initial_sent_at && (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg border border-[#c8a44b]/20 bg-[#c8a44b]/5 p-3">
                    <p className="text-[11px] text-[#c8c4bc70]">After you independently send this message, record the real-world attempt here. This button never sends email.</p>
                    <button
                      type="button"
                      onClick={() => handleRecordManualAttempt(selectedLead.id)}
                      disabled={interactionLoading}
                      className="shrink-0 px-3 py-2 border border-[#c8a44b]/40 text-[#c8a44b] hover:bg-[#c8a44b]/10 rounded-md text-[10px] font-mono disabled:opacity-40"
                    >
                      I sent this manually — record attempt
                    </button>
                  </div>
                )}
              </div>
            )}

            {selectedLead.followup_body && (
              <div className="space-y-3 border-t border-[#c8c4bc12] pt-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-[11px] font-mono text-[#c8a44b] uppercase tracking-wider">Follow-up preview</h4>
                    <p className="text-[11px] text-[#c8c4bc55] mt-1">Review this second message separately. It cannot send until explicitly approved.</p>
                  </div>
                  <span className={`shrink-0 px-2 py-1 rounded-md text-[10px] font-mono ${
                    selectedLead.followup_approval_status === 'approved'
                      ? 'bg-[#6dc86d]/10 border border-[#6dc86d]/20 text-[#6dc86d]'
                      : 'bg-[#c8a44b]/10 border border-[#c8a44b]/20 text-[#c8a44b]'
                  }`}>
                    {selectedLead.followup_approval_status === 'approved' ? 'Approved' : 'Awaiting review'}
                  </span>
                </div>
                <div className="p-3 bg-[#141414] border border-[#c8c4bc15] rounded-lg text-xs font-mono text-[#c8c4bc]">
                  {selectedLead.followup_subject || 'No subject generated'}
                </div>
                <div className="p-4 bg-[#141414] border border-[#c8c4bc15] rounded-lg text-xs leading-relaxed text-[#c8c4bc] font-mono whitespace-pre-wrap">
                  {selectedLead.followup_body}
                </div>
              </div>
            )}

            <div className="space-y-3 border-t border-[#c8c4bc12] pt-4">
              <div>
                <h4 className="text-[11px] font-mono text-[#c8a44b] uppercase tracking-wider">Validation interaction log</h4>
                <p className="text-[11px] text-[#c8c4bc55] mt-1">Record the channel, outcome, objection, and next step. This does not send anything.</p>
              </div>
              <div className="bg-[#141414] border border-[#c8c4bc12] rounded-lg p-3 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <select
                    value={interactionForm.channel}
                    onChange={(e) => setInteractionForm((current) => ({ ...current, channel: e.target.value }))}
                    className="px-2.5 py-2 bg-[#1c1c1c] border border-[#c8c4bc20] rounded-md text-xs text-[#c8c4bc]"
                    aria-label="Interaction channel"
                  >
                    <option value="email">Email</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="phone">Phone</option>
                    <option value="in_person">In person</option>
                    <option value="linkedin">LinkedIn</option>
                    <option value="other">Other</option>
                  </select>
                  <select
                    value={interactionForm.outcome}
                    onChange={(e) => setInteractionForm((current) => ({ ...current, outcome: e.target.value }))}
                    className="px-2.5 py-2 bg-[#1c1c1c] border border-[#c8c4bc20] rounded-md text-xs text-[#c8c4bc]"
                    aria-label="Interaction outcome"
                  >
                    <option value="attempted">Attempted contact</option>
                    <option value="permission_granted">Permission granted</option>
                    <option value="conversation">Conversation</option>
                    <option value="audit_walkthrough">Audit walkthrough</option>
                    <option value="proposal_sent">Proposal sent</option>
                    <option value="paid_pilot">Paid pilot</option>
                    <option value="no_response">No response</option>
                    <option value="not_fit">Not a fit</option>
                    <option value="unsubscribe">Unsubscribe / do not contact</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <textarea
                  value={interactionForm.note}
                  onChange={(e) => setInteractionForm((current) => ({ ...current, note: e.target.value }))}
                  placeholder="What happened? Include objection, decision-maker, or promised next step."
                  rows={3}
                  className="w-full px-2.5 py-2 bg-[#1c1c1c] border border-[#c8c4bc20] rounded-md text-xs text-[#c8c4bc] placeholder-[#c8c4bc35] resize-y"
                />
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="date"
                    value={interactionForm.nextActionAt}
                    onChange={(e) => setInteractionForm((current) => ({ ...current, nextActionAt: e.target.value }))}
                    className="px-2.5 py-2 bg-[#1c1c1c] border border-[#c8c4bc20] rounded-md text-xs text-[#c8c4bc]"
                    aria-label="Next action date"
                  />
                  <button
                    type="button"
                    onClick={() => handleAddInteraction(selectedLead.id)}
                    disabled={interactionLoading}
                    className="px-3 py-2 bg-[#8b3a2a] hover:bg-[#9e4331] rounded-md text-xs font-mono text-[#c8c4bc] disabled:opacity-40"
                  >
                    {interactionLoading ? 'Saving…' : 'Record interaction'}
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                {initialInteractions.filter((item) => item.lead_id === selectedLead.id).slice(0, 8).map((item) => (
                  <div key={item.id} className="flex flex-col sm:flex-row sm:items-start justify-between gap-1 bg-[#141414] border border-[#c8c4bc0e] rounded-md px-3 py-2 text-[11px] font-mono">
                    <div>
                      <span className="text-white capitalize">{item.outcome.replaceAll('_', ' ')}</span>
                      <span className="text-[#c8c4bc45]"> · {item.channel.replaceAll('_', ' ')}</span>
                      {item.note && <p className="text-[#c8c4bc70] mt-1 whitespace-pre-wrap">{item.note}</p>}
                    </div>
                    <span className="text-[#c8c4bc45] shrink-0">{new Date(item.occurred_at).toLocaleDateString()}</span>
                  </div>
                ))}
                {initialInteractions.filter((item) => item.lead_id === selectedLead.id).length === 0 && (
                  <p className="text-[11px] text-[#c8c4bc40]">No interactions recorded yet.</p>
                )}
              </div>
            </div>

            {/* Intel Modal Footer Action Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[#c8c4bc12]">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleOpenEdit(selectedLead)}
                  className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-[#c8c4bc] rounded-lg text-xs font-mono border border-white/10 transition-colors flex items-center gap-1.5"
                >
                  <Edit2 size={13} />
                  <span>Edit</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleReauditLead(selectedLead.id)}
                  disabled={reauditingLeadId === selectedLead.id}
                  className="px-3 py-1.5 bg-[#141414] hover:bg-[#222] text-[#c8a44b] rounded-lg text-xs font-mono border border-[#c8a44b]/30 transition-colors flex items-center gap-1.5 disabled:opacity-40"
                >
                  {reauditingLeadId === selectedLead.id ? (
                    <span className="w-3 h-3 border-2 border-[#c8a44b] border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <RefreshCw size={13} />
                  )}
                  <span>Re-Audit</span>
                </button>
                {selectedLead.email && (
                  <button
                    type="button"
                    onClick={() => handleRegeneratePitch(selectedLead.id)}
                    disabled={regeneratingLeadId === selectedLead.id}
                    className="px-3 py-1.5 bg-[#8b3a2a]/20 hover:bg-[#8b3a2a]/30 text-[#c8c4bc] rounded-lg text-xs font-mono border border-[#8b3a2a]/40 transition-colors flex items-center gap-1.5 disabled:opacity-40"
                  >
                    {regeneratingLeadId === selectedLead.id ? (
                      <span className="w-3 h-3 border-2 border-[#c8c4bc] border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Sparkles size={13} />
                    )}
                    <span>Re-Generate</span>
                  </button>
                )}
                {/* Approval gate — approval never sends an unreviewed draft. */}
                {selectedLead.email && selectedLead.generated_body && !selectedLead.initial_sent_at && (
                  <button
                    type="button"
                    onClick={() => handleSendSingle(selectedLead.id, selectedLead.initial_approval_status === 'approved')}
                    disabled={sendingLeadId === selectedLead.id}
                    className="px-3 py-1.5 bg-[#6dc86d]/10 hover:bg-[#6dc86d]/20 text-[#6dc86d] rounded-lg text-xs font-mono border border-[#6dc86d]/30 transition-colors flex items-center gap-1.5 disabled:opacity-40"
                    title={selectedLead.initial_approval_status === 'approved' ? 'Revoke approval for this draft' : 'Approve this reviewed draft for a later approved-send run'}
                  >
                    {sendingLeadId === selectedLead.id ? (
                      <span className="w-3 h-3 border-2 border-[#6dc86d] border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Send size={13} />
                    )}
                    <span>{selectedLead.initial_approval_status === 'approved' ? 'Revoke Approval' : 'Approve for Sending'}</span>
                  </button>
                )}
                {/* Enrich Email — for leads missing an email */}
                {selectedLead.initial_sent_at && selectedLead.followup_body && !selectedLead.followup_sent_at && (
                  <button
                    type="button"
                    onClick={() => handleFollowupApproval(selectedLead.id, selectedLead.followup_approval_status === 'approved')}
                    disabled={sendingLeadId === selectedLead.id}
                    className="px-3 py-1.5 bg-[#c8a44b]/10 hover:bg-[#c8a44b]/20 text-[#c8a44b] rounded-lg text-xs font-mono border border-[#c8a44b]/30 transition-colors flex items-center gap-1.5 disabled:opacity-40"
                    title={selectedLead.followup_approval_status === 'approved' ? 'Revoke follow-up approval' : 'Approve this reviewed follow-up for a later approved-send run'}
                  >
                    {sendingLeadId === selectedLead.id ? (
                      <span className="w-3 h-3 border-2 border-[#c8a44b] border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Send size={13} />
                    )}
                    <span>{selectedLead.followup_approval_status === 'approved' ? 'Revoke Follow-up' : 'Approve Follow-up'}</span>
                  </button>
                )}
                {!selectedLead.email && (
                  <button
                    type="button"
                    onClick={() => handleEnrichSingle(selectedLead.id)}
                    disabled={enrichingSingleId === selectedLead.id}
                    className="px-3 py-1.5 bg-[#c8a44b]/10 hover:bg-[#c8a44b]/20 text-[#c8a44b] rounded-lg text-xs font-mono border border-[#c8a44b]/30 transition-colors flex items-center gap-1.5 disabled:opacity-40"
                  >
                    {enrichingSingleId === selectedLead.id ? (
                      <span className="w-3 h-3 border-2 border-[#c8a44b] border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Zap size={13} />
                    )}
                    <span>Find Email</span>
                  </button>
                )}
                {/* Run Full Pipeline — for stuck leads */}
                {['new', 'no_website', 'email_needed', 'scraped'].includes(selectedLead.status) && (
                  <button
                    type="button"
                    onClick={() => handleRunLeadPipeline(selectedLead.id)}
                    disabled={pipelineLeadId === selectedLead.id}
                    className="px-3 py-1.5 bg-[#8b3a2a]/10 hover:bg-[#8b3a2a]/20 text-[#c8c4bc] rounded-lg text-xs font-mono border border-[#8b3a2a]/30 transition-colors flex items-center gap-1.5 disabled:opacity-40"
                  >
                    {pipelineLeadId === selectedLead.id ? (
                      <span className="w-3 h-3 border-2 border-[#c8c4bc] border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Play size={13} />
                    )}
                    <span>Run Pipeline</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleDeleteLead(selectedLead.id, selectedLead.business_name)}
                  disabled={deletingLeadId === selectedLead.id}
                  className="px-3 py-1.5 bg-[#141414] hover:bg-[#8b3a2a]/20 text-[#e85d4a] rounded-lg text-xs font-mono border border-[#e85d4a]/30 transition-colors flex items-center gap-1.5 disabled:opacity-40"
                >
                  <Trash2 size={13} />
                  <span>Delete</span>
                </button>
              </div>
              <button
                onClick={() => setExpandedLeadId(null)}
                className="px-4 py-1.5 bg-white/5 hover:bg-white/10 text-[#c8c4bc] rounded-lg text-xs border border-[#c8c4bc20] transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT LEAD MODAL */}
      {editingLead && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm cursor-pointer"
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditingLead(null)
          }}
        >
          <div className="bg-[#1c1c1c] border border-[#c8c4bc20] rounded-xl max-w-lg w-full p-6 space-y-4 shadow-2xl cursor-default">
            <div className="flex justify-between items-start border-b border-[#c8c4bc12] pb-3">
              <div>
                <h3 className="text-sm font-semibold text-white">Edit Prospect Details</h3>
                <p className="text-xs text-[#c8c4bc70]">Update business information or manually override status.</p>
              </div>
              <button onClick={() => setEditingLead(null)} className="text-[#c8c4bc70] hover:text-white text-sm"><X size={14} /></button>
            </div>

            {editError && (
              <div className="text-xs font-mono text-[#e85d4a] bg-[#8b3a2a]/20 border border-[#8b3a2a]/50 p-2.5 rounded-lg">
                {editError}
              </div>
            )}

            <form onSubmit={handleSaveEdit} className="space-y-3 text-xs">
              <div>
                <label className="text-[11px] text-[#c8c4bc70] block mb-1">Business Name *</label>
                <input
                  type="text"
                  value={editForm.business_name}
                  onChange={(e) => setEditForm({ ...editForm, business_name: e.target.value })}
                  className="w-full px-3 py-1.5 bg-[#141414] border border-[#c8c4bc20] rounded-lg text-[#c8c4bc] focus:outline-none focus:border-[#8b3a2a]"
                  required
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-[#c8c4bc70] block mb-1">Email Address</label>
                  <input
                    type="email"
                    value={editForm.email}
                    onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                    className="w-full px-3 py-1.5 bg-[#141414] border border-[#c8c4bc20] rounded-lg text-[#c8c4bc] focus:outline-none focus:border-[#8b3a2a]"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-[#c8c4bc70] block mb-1">Phone Number</label>
                  <input
                    type="text"
                    value={editForm.phone}
                    onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                    className="w-full px-3 py-1.5 bg-[#141414] border border-[#c8c4bc20] rounded-lg text-[#c8c4bc] focus:outline-none focus:border-[#8b3a2a]"
                  />
                </div>
              </div>
              <div>
                <label className="text-[11px] text-[#c8c4bc70] block mb-1">Website URL</label>
                <input
                  type="text"
                  value={editForm.website}
                  onChange={(e) => setEditForm({ ...editForm, website: e.target.value })}
                  className="w-full px-3 py-1.5 bg-[#141414] border border-[#c8c4bc20] rounded-lg text-[#c8c4bc] focus:outline-none focus:border-[#8b3a2a]"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-[#c8c4bc70] block mb-1">Address / Metro</label>
                  <input
                    type="text"
                    value={editForm.address}
                    onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                    className="w-full px-3 py-1.5 bg-[#141414] border border-[#c8c4bc20] rounded-lg text-[#c8c4bc] focus:outline-none focus:border-[#8b3a2a]"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-[#c8c4bc70] block mb-1">Pipeline Status</label>
                  <select
                    value={editForm.status}
                    onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                    className="w-full px-3 py-1.5 bg-[#141414] border border-[#c8c4bc20] rounded-lg text-[#c8c4bc] focus:outline-none focus:border-[#8b3a2a]"
                  >
                    <option value="new">new (pending audit)</option>
                    <option value="scraped">scraped (audited)</option>
                    <option value="generated">generated (pitch ready)</option>
                    <option value="sent">sent (dispatched)</option>
                    <option value="followed_up">followed_up</option>
                    <option value="email_needed">email_needed</option>
                    <option value="no_website">no_website</option>
                    <option value="failed">failed</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[#c8c4bc12]">
                <button
                  type="button"
                  onClick={() => setEditingLead(null)}
                  className="px-3.5 py-1.5 bg-white/5 hover:bg-white/10 text-[#c8c4bc] border border-white/10 rounded-lg border border-[#c8c4bc20]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editLoading}
                  className="px-4 py-1.5 bg-[#8b3a2a]/10 hover:bg-[#8b3a2a]/20 text-[#8b3a2a] border border-[#8b3a2a]/30 rounded-lg transition-all disabled:opacity-40"
                >
                  {editLoading ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CLEAR TEST DATA CONFIRMATION MODAL */}
      {isClearModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm cursor-pointer"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsClearModalOpen(false)
          }}
        >
          <div className="bg-[#1c1c1c] border border-[#c8c4bc20] rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl cursor-default">
            <div className="flex justify-between items-start border-b border-[#c8c4bc12] pb-3">
              <div>
                <h3 className="text-sm font-semibold text-[#e85d4a] flex items-center gap-2">
                  <span><AlertTriangle size={16} className="inline mr-1" /></span>
                  <span>Clear Lead Database</span>
                </h3>
                <p className="text-xs text-[#c8c4bc70] mt-0.5">Purge old test leads to start fresh with small batch tests.</p>
              </div>
              <button onClick={() => setIsClearModalOpen(false)} className="text-[#c8c4bc70] hover:text-white text-sm"><X size={14} /></button>
            </div>

            <div className="space-y-3 text-xs">
              <p className="text-[#c8c4bc]">
                This will delete all <strong>{stats.total}</strong> leads in your current prospect directory.
              </p>

              <label className="flex items-start gap-2.5 p-3 bg-[#141414] border border-[#c8c4bc15] rounded-lg cursor-pointer">
                <input
                  type="checkbox"
                  checked={clearSuppressed}
                  onChange={(e) => setClearSuppressed(e.target.checked)}
                  className="rounded border-[#c8c4bc30] bg-[#141414] text-[#8b3a2a] focus:ring-0 mt-0.5"
                />
                <div>
                  <span className="font-medium text-white block">Reset Suppressions</span>
                  <span className="text-[11px] text-[#c8c4bc60]">
                    Allows Google Places discovery to re-fetch and test the same businesses you discovered previously.
                  </span>
                </div>
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-[#c8c4bc12]">
              <button
                type="button"
                onClick={() => setIsClearModalOpen(false)}
                className="px-3.5 py-1.5 bg-white/5 hover:bg-white/10 text-[#c8c4bc] border border-white/10 rounded-lg border border-[#c8c4bc20] text-xs font-mono"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleClearAllLeads}
                disabled={isClearing}
                className="px-4 py-1.5 bg-[#8b3a2a]/10 hover:bg-[#8b3a2a]/20 text-[#8b3a2a] border border-[#8b3a2a]/30 rounded-lg text-xs font-mono transition-all disabled:opacity-40"
              >
                {isClearing ? 'Clearing...' : 'Yes, Delete All Leads'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ERROR DETAILS MODAL */}
      {isErrorModalOpen && selectedError && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm cursor-pointer"
          onClick={(e) => {
            if (e.target === e.currentTarget) setExpandedErrorId(null)
          }}
        >
          <div ref={errorDialogRef} tabIndex={-1} role="dialog" aria-modal="true"
            className="bg-[#1c1c1c] border border-[#c8c4bc20] rounded-xl max-w-xl w-full p-6 space-y-4 shadow-2xl focus:outline-none cursor-default">
            <div className="flex justify-between items-start border-b border-[#c8c4bc12] pb-3">
              <div>
                <h3 className="text-sm font-semibold text-[#8b3a2a] font-mono">{selectedError.source} / {selectedError.stage}</h3>
                <p className="text-xs text-[#c8c4bc70] font-mono mt-0.5">{mounted ? new Date(selectedError.created_at).toLocaleString() : '…'}</p>
              </div>
              <button onClick={() => setExpandedErrorId(null)} className="text-[#c8c4bc70] hover:text-white text-sm" aria-label="Close"><X size={14} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-mono text-[#c8c4bc70] block mb-1">Exception Message</label>
                <p className="text-xs text-[#c8c4bc] bg-[#141414] p-3 rounded-lg border border-[#c8c4bc15] font-mono">{selectedError.message}</p>
              </div>
              {selectedError.context != null && (
                <div>
                  <label className="text-[11px] font-mono text-[#c8c4bc70] block mb-1">Context Payload</label>
                  <pre className="text-[11px] text-[#c8c4bc] bg-[#141414] p-3 rounded-lg border border-[#c8c4bc15] font-mono overflow-x-auto max-h-48">
                    {JSON.stringify(selectedError.context, null, 2)}
                  </pre>
                </div>
              )}
            </div>
            <div className="flex justify-end pt-2 border-t border-[#c8c4bc12]">
              <button onClick={() => setExpandedErrorId(null)}
                className="px-4 py-1.5 bg-white/5 hover:bg-white/10 text-[#c8c4bc] rounded-lg text-xs border border-[#c8c4bc20]">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* STATS CARD DETAILS MODAL (6 TABS) */}
      {isStatsModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm cursor-pointer"
          onClick={(e) => {
            if (e.target === e.currentTarget) setStatsModalType(null)
          }}
        >
          <div
            ref={statsDialogRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            className="bg-[#1c1c1c] border border-[#c8c4bc20] rounded-xl max-w-4xl w-full p-6 space-y-5 shadow-2xl focus:outline-none max-h-[90vh] flex flex-col cursor-default"
          >
            {/* Modal Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-[#c8c4bc12] pb-4 shrink-0">
              <div>
                <div className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${
                    statsModalType === 'ready_to_contact' ? 'bg-[#6dc86d]'
                    : statsModalType === 'replies' ? 'bg-[#c8a44b]'
                    : 'bg-[#8b3a2a]'
                  }`} />
                  <h3 className="text-base font-semibold text-white">
                    {statsModalType === 'prospect_pool' && 'Prospect Pool Directory'}
                    {statsModalType === 'audited' && 'Audited Prospects & Intelligence'}
                    {statsModalType === 'ready_to_contact' && 'Contact Candidates (Human Review Required)'}
                    {statsModalType === 'sent_today' && "Today's Dispatched Outreach"}
                    {statsModalType === 'total_dispatched' && 'All Dispatched Pitches & Follow-ups'}
                    {statsModalType === 'replies' && 'Inbound Replies & Client Responses'}
                  </h3>
                </div>
                <p className="text-xs text-[#c8c4bc70] mt-1">
                  {statsModalType === 'prospect_pool' && 'Complete listing of all discovered, queued, and processed businesses in your database.'}
                  {statsModalType === 'audited' && 'Prospects evaluated with 6-dimensional opportunity, SEO, mobile, and conversion audit scores.'}
                  {statsModalType === 'ready_to_contact' && 'Prospects with a discovered email and no recorded send or reply. Re-check the source, review the draft, and approve manually before any contact.'}
                  {statsModalType === 'sent_today' && 'Emails transmitted today through your personal Gmail account with human-like delays.'}
                  {statsModalType === 'total_dispatched' && 'Historical log of all initial outreach emails and automated follow-ups sent to date.'}
                  {statsModalType === 'replies' && 'Track and log positive responses from prospects to close high-ticket web design & SEO deals.'}
                </p>
              </div>
              <div className="flex items-center gap-2 self-end sm:self-center">
                <button
                  onClick={() => setStatsModalType(null)}
                  className="text-[#c8c4bc70] hover:text-white p-1 text-sm font-mono"
                  aria-label="Close"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Quick Search, Filter & Bulk Actions */}
            <div className="space-y-3 shrink-0">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <input
                  type="text"
                  placeholder="Filter by business name, email, website, angle..."
                  value={statsModalSearch}
                  onChange={(e) => setStatsModalSearch(e.target.value)}
                  className="w-full sm:w-80 px-3.5 py-1.5 bg-[#141414] border border-[#c8c4bc20] rounded-lg text-xs text-[#c8c4bc] placeholder-[#c8c4bc35] focus:outline-none focus:border-[#8b3a2a]"
                />
                <div className="flex items-center gap-2 text-xs font-mono text-[#c8c4bc60]">
                  <span>
                    {initialLeads.filter((lead) => {
                      const isTodayLead = (dateStr: string | null) => {
                        if (!dateStr) return false
                        const d = new Date(dateStr)
                        const t = new Date()
                        return d.getUTCFullYear() === t.getUTCFullYear() && d.getUTCMonth() === t.getUTCMonth() && d.getUTCDate() === t.getUTCDate()
                      }
                      if (statsModalType === 'audited') return lead.last_audited_at !== null || lead.opportunity_score !== null
                      if (statsModalType === 'ready_to_contact') return Boolean(lead.email) && (lead.status === 'scraped' || lead.status === 'generated') && !lead.initial_sent_at && !lead.replied_at
                      if (statsModalType === 'sent_today') return isTodayLead(lead.initial_sent_at) || isTodayLead(lead.followup_sent_at)
                      if (statsModalType === 'total_dispatched') return lead.status === 'sent' || lead.status === 'followed_up' || Boolean(lead.initial_sent_at)
                      if (statsModalType === 'replies') return Boolean(lead.replied_at)
                      return true
                    }).filter((lead) => {
                      if (!statsModalSearch) return true
                      const q = statsModalSearch.toLowerCase()
                      return lead.business_name.toLowerCase().includes(q) || (lead.email && lead.email.toLowerCase().includes(q)) || (lead.website && lead.website.toLowerCase().includes(q))
                    }).length} records
                  </span>
                </div>
              </div>

              {/* Modal Bulk Actions Toolbar */}
              {selectedLeadIds.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-[#141414] border border-[#c8c4bc20] rounded-lg text-xs font-mono">
                  <div className="flex items-center gap-2 text-[#c8c4bc]">
                    <span className="font-semibold text-white">{selectedLeadIds.length}</span> selected
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleBulkSend}
                      disabled={bulkActionLoading}
                      className="px-2.5 py-1 rounded bg-[#6dc86d]/10 hover:bg-[#6dc86d]/20 text-[#6dc86d] border border-[#6dc86d]/30 flex items-center gap-1.5 disabled:opacity-40"
                      title="Approve generated drafts for selected leads"
                    >
                      <Send size={12} />
                      <span>Send Outreach ({selectedLeadIds.length})</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleBulkReaudit}
                      disabled={bulkActionLoading}
                      className="px-2.5 py-1 rounded bg-[#c8a44b]/10 hover:bg-[#c8a44b]/20 text-[#c8a44b] border border-[#c8a44b]/30 flex items-center gap-1.5 disabled:opacity-40"
                    >
                      <RefreshCw size={12} />
                      <span>Re-Audit ({selectedLeadIds.length})</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleBulkDelete}
                      disabled={bulkActionLoading}
                      className="px-2.5 py-1 rounded bg-[#8b3a2a]/10 hover:bg-[#8b3a2a]/20 text-[#e85d4a] border border-[#e85d4a]/30 flex items-center gap-1.5 disabled:opacity-40"
                    >
                      <Trash2 size={12} />
                      <span>Delete ({selectedLeadIds.length})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedLeadIds([])}
                      className="px-2 py-1 text-[#c8c4bc60] hover:text-white"
                    >
                      Deselect
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Table Content */}
            <div className="overflow-y-auto flex-1 border border-[#c8c4bc12] rounded-lg bg-[#151515]">
              {(() => {
                const isTodayLead = (dateStr: string | null) => {
                  if (!dateStr) return false
                  const d = new Date(dateStr)
                  const t = new Date()
                  return d.getUTCFullYear() === t.getUTCFullYear() && d.getUTCMonth() === t.getUTCMonth() && d.getUTCDate() === t.getUTCDate()
                }

                const filtered = initialLeads
                  .filter((lead) => {
                    if (statsModalType === 'audited') return lead.last_audited_at !== null || lead.opportunity_score !== null
                    if (statsModalType === 'ready_to_contact') return Boolean(lead.email) && (lead.status === 'scraped' || lead.status === 'generated') && !lead.initial_sent_at && !lead.replied_at
                    if (statsModalType === 'sent_today') return isTodayLead(lead.initial_sent_at) || isTodayLead(lead.followup_sent_at)
                    if (statsModalType === 'total_dispatched') return lead.status === 'sent' || lead.status === 'followed_up' || Boolean(lead.initial_sent_at)
                    if (statsModalType === 'replies') return Boolean(lead.replied_at)
                    return true
                  })
                  .filter((lead) => {
                    if (!statsModalSearch) return true
                    const q = statsModalSearch.toLowerCase()
                    return lead.business_name.toLowerCase().includes(q) || (lead.email && lead.email.toLowerCase().includes(q)) || (lead.website && lead.website.toLowerCase().includes(q))
                  })

                if (filtered.length === 0) {
                  return (
                    <div className="p-8 text-center text-[#c8c4bc60] space-y-1">
                      <p className="text-sm font-medium text-[#c8c4bc80]">No leads match this view</p>
                      <p className="text-xs text-[#c8c4bc50]">
                        {statsModalType === 'replies'
                          ? 'No replies recorded yet. When a lead replies to your email, click "+1 Log Reply" or toggle below.'
                          : 'Use "Find Prospects", "Enrich Emails", or "Run Pipeline" to populate this pool.'}
                      </p>
                    </div>
                  )
                }

                const visibleIds = filtered.map((l) => l.id)
                const isAllSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedLeadIds.includes(id))

                return (
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#181818] border-b border-[#c8c4bc12] text-[#c8c4bc70] font-mono text-[11px] sticky top-0">
                      <tr>
                        <th className="w-8 px-3 py-2.5">
                          <input
                            type="checkbox"
                            checked={isAllSelected}
                            onChange={() => handleToggleSelectAll(visibleIds)}
                            className="rounded border-[#c8c4bc30] bg-[#141414] text-[#8b3a2a] focus:ring-0 cursor-pointer"
                          />
                        </th>
                        <th className="px-3 py-2.5 font-normal">Business</th>
                        <th className="px-3 py-2.5 font-normal">Status</th>
                        <th className="px-3 py-2.5 font-normal">Contact Email</th>
                        {statsModalType === 'audited' && (
                          <>
                            <th className="px-3 py-2.5 font-normal">Opportunity</th>
                            <th className="px-3 py-2.5 font-normal">SEO</th>
                            <th className="px-3 py-2.5 font-normal">Mobile</th>
                            <th className="px-3 py-2.5 font-normal">Design</th>
                            <th className="px-3 py-2.5 font-normal">Angle</th>
                          </>
                        )}
                        {(statsModalType === 'sent_today' || statsModalType === 'total_dispatched') && (
                          <>
                            <th className="px-3 py-2.5 font-normal">Dispatched At</th>
                            <th className="px-3 py-2.5 font-normal">Subject</th>
                          </>
                        )}
                        {statsModalType === 'replies' && (
                          <>
                            <th className="px-3 py-2.5 font-normal">Replied?</th>
                            <th className="px-3 py-2.5 font-normal">Sent At</th>
                          </>
                        )}
                        <th className="px-3 py-2.5 font-normal text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#c8c4bc0a]">
                      {filtered.map((lead) => {
                        const isSelected = selectedLeadIds.includes(lead.id)
                        return (
                          <tr key={lead.id} className={`hover:bg-[#1f1f1f] transition-colors ${isSelected ? 'bg-[#8b3a2a]/10' : ''}`}>
                            <td className="px-3 py-2.5">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => handleToggleSelectLead(lead.id)}
                                className="rounded border-[#c8c4bc30] bg-[#141414] text-[#8b3a2a] focus:ring-0 cursor-pointer"
                              />
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="font-medium text-white truncate max-w-[180px]" title={lead.business_name}>
                                {lead.business_name}
                              </div>
                              {lead.website && (
                                <div className="text-[11px] text-[#c8a44b] truncate max-w-[180px] mt-0.5">{lead.website}</div>
                              )}
                            </td>
                            <td className="px-3 py-2.5">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono capitalize bg-[#1c1c1c] text-[#c8c4bc] border border-[#c8c4bc15]">
                                {lead.status.replace('_', ' ')}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 font-mono text-[#c8c4bc]">
                              {lead.email ? (
                                <div className="flex items-center gap-1.5">
                                  <ConfidenceDot confidence={lead.email_confidence} />
                                  <span className="truncate max-w-[150px] text-[11px] text-[#e0ded8]">{lead.email}</span>
                                </div>
                              ) : (
                                <span className="text-[#c8c4bc40] text-[11px] italic">No email</span>
                              )}
                            </td>
                            {statsModalType === 'audited' && (
                              <>
                                <td className="px-3 py-2.5"><OpportunityBadge score={lead.opportunity_score} /></td>
                                <td className="px-3 py-2.5"><ScorePill score={lead.seo_score} /></td>
                                <td className="px-3 py-2.5"><ScorePill score={lead.mobile_score} /></td>
                                <td className="px-3 py-2.5"><ScorePill score={lead.design_score} /></td>
                                <td className="px-3 py-2.5"><AnglePill angle={lead.outreach_angle} /></td>
                              </>
                            )}
                            {(statsModalType === 'sent_today' || statsModalType === 'total_dispatched') && (
                              <>
                                <td className="px-3 py-2.5 text-[11px] font-mono text-[#c8c4bc70] tabular-nums">
                                  {lead.initial_sent_at ? new Date(lead.initial_sent_at).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                                </td>
                                <td className="px-3 py-2.5 text-[11px] font-mono text-[#c8c4bc] max-w-xs truncate" title={lead.generated_subject || ''}>
                                  {lead.generated_subject || 'Initial Pitch'}
                                </td>
                              </>
                            )}
                            {statsModalType === 'replies' && (
                              <>
                                <td className="px-3 py-2.5">
                                  <button
                                    type="button"
                                    onClick={() => handleToggleLeadReply(lead.id, !lead.replied_at)}
                                    className={`px-2.5 py-1 rounded text-[11px] font-mono transition-all border ${
                                      lead.replied_at
                                        ? 'bg-[#6dc86d]/20 border-[#6dc86d]/50 text-[#6dc86d] font-medium'
                                        : 'bg-[#1c1c1c] border-[#c8c4bc20] text-[#c8c4bc70] hover:text-[#c8a44b] hover:border-[#c8a44b]/50'
                                    }`}
                                  >
                                    {lead.replied_at ? 'Replied' : '+ Mark Replied'}
                                  </button>
                                </td>
                                <td className="px-3 py-2.5 text-[11px] font-mono text-[#c8c4bc70] tabular-nums">
                                  {lead.initial_sent_at ? new Date(lead.initial_sent_at).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '—'}
                                </td>
                              </>
                            )}
                            <td className="px-3 py-2.5 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setStatsModalType(null)
                                    setExpandedLeadId(lead.id)
                                  }}
                                  className="px-2 py-1 rounded text-[10px] font-mono text-[#c8c4bc] border border-white/10 hover:border-white/30 hover:bg-white/5 transition-colors"
                                  title="View Intel Profile"
                                >
                                  Intel
                                </button>
                                    {lead.status === 'generated' && lead.email && lead.generated_body && !lead.initial_sent_at && (
                                  <button
                                    type="button"
                                    onClick={() => handleSendSingle(lead.id, lead.initial_approval_status === 'approved')}
                                    disabled={sendingLeadId === lead.id}
                                    className="p-1 rounded text-[11px] text-[#6dc86d] border border-[#6dc86d]/30 hover:bg-[#6dc86d]/20 transition-all disabled:opacity-40"
                                    title={lead.initial_approval_status === 'approved' ? 'Revoke approval' : 'Approve this generated draft for sending'}
                                  >
                                    <Send size={12} />
                                  </button>
                                )}
                                {!lead.email && (
                                  <button
                                    type="button"
                                    onClick={() => handleEnrichSingle(lead.id)}
                                    disabled={enrichingSingleId === lead.id}
                                    className="p-1 rounded text-[11px] text-[#c8a44b] border border-[#c8a44b]/30 hover:bg-[#c8a44b]/20 transition-all disabled:opacity-40"
                                    title="Find Email"
                                  >
                                    <Zap size={12} />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleReauditLead(lead.id)}
                                  disabled={reauditingLeadId === lead.id}
                                  className="p-1 rounded text-[11px] text-[#c8c4bc70] border border-white/10 hover:text-white hover:border-[#c8a44b] transition-all disabled:opacity-40"
                                  title="Re-Audit"
                                >
                                  <RefreshCw size={12} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleOpenEdit(lead)}
                                  className="p-1 rounded text-[11px] text-[#c8c4bc70] border border-white/10 hover:text-white transition-colors"
                                  title="Edit Lead"
                                >
                                  <Edit2 size={12} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteLead(lead.id, lead.business_name)}
                                  disabled={deletingLeadId === lead.id}
                                  className="p-1 rounded text-[11px] text-[#e85d4a] border border-[#e85d4a]/30 hover:bg-[#8b3a2a]/20 transition-colors disabled:opacity-40"
                                  title="Delete Lead"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )
              })()}
            </div>

            {/* Modal Footer */}
            <div className="flex justify-between items-center pt-3 border-t border-[#c8c4bc12] shrink-0">
              <div className="text-[11px] font-mono text-[#c8c4bc60]">
                {statsModalType === 'replies'
                  ? `Total Replies Tracked: ${stats.replies_total}`
                  : statsModalType === 'ready_to_contact'
                  ? `${stats.ready_to_contact} contact candidates requiring source and draft review`
                  : 'Click "Intel Profile" on any row to view complete pitch & audit details'}
              </div>
              <button
                onClick={() => setStatsModalType(null)}
                className="px-4 py-1.5 bg-white/5 hover:bg-white/10 text-[#c8c4bc] rounded-lg text-xs border border-[#c8c4bc20]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
