import {
  FrVtubersTeamMember,
  frVtubersTeamGeneratedAt,
  frVtubersTeamMembers as generatedTeamMembers,
} from './generated/frvtubersTeam'
import {
  GeneratedVtuberProfile,
  vtuberCatalog,
} from './generated/vtuberCatalog'
import {
  manualAdditionalVtuberDids,
  manualAdditionalVtuberHandles,
  manualFrVtuberTeamDids,
  manualFrVtuberTeamHandles,
} from './manualOverrides'

export interface VtuberProfile extends GeneratedVtuberProfile {}
export type { FrVtubersTeamMember }

const vtuberByDid = new Map<string, VtuberProfile>()
const vtuberByHandle = new Map<string, VtuberProfile>()
const baseTeamFlagByDid = new Map<string, boolean>()

const vtuberDidSet = new Set<string>()
const frTeamDidSet = new Set<string>()
const frTeamLogins = new Set<string>()
const frTeamNormalizedLogins = new Set<string>()
let frTeamLoginsList: string[] = []
let frTeamNormalizedLoginsList: string[] = []

let currentTeamMembers: FrVtubersTeamMember[] = []
let currentTeamGeneratedAt: string | undefined = frVtubersTeamGeneratedAt
let lastTeamRefreshIso: string | undefined

const ensureVtuberProfile = (
  did: string,
  fallbackHandle?: string,
): VtuberProfile => {
  const normalizedDid = did.trim()
  vtuberDidSet.add(normalizedDid)
  let profile = vtuberByDid.get(normalizedDid)
  if (!profile) {
    const handle = (fallbackHandle ?? normalizedDid).toLowerCase()
    profile = {
      did: normalizedDid,
      handle,
      displayName: undefined,
      description: undefined,
      score: 0,
      matchedTerms: [],
      twitchLogin: undefined,
      isFrVtubersTeam: false,
    }
    vtuberByDid.set(normalizedDid, profile)
    vtuberByHandle.set(handle, profile)
    baseTeamFlagByDid.set(normalizedDid, false)
  }
  return profile
}

const initializeFromCatalog = () => {
  for (const catalogEntry of vtuberCatalog) {
    const mutableProfile: VtuberProfile = { ...catalogEntry }
    vtuberByDid.set(mutableProfile.did, mutableProfile)
    vtuberByHandle.set(mutableProfile.handle.toLowerCase(), mutableProfile)
    vtuberDidSet.add(mutableProfile.did)
    baseTeamFlagByDid.set(
      mutableProfile.did,
      Boolean(mutableProfile.isFrVtubersTeam),
    )
  }
}

const applyManualVtuberOverrides = () => {
  for (const did of manualAdditionalVtuberDids) {
    if (!did) continue
    ensureVtuberProfile(did)
  }
  for (const handle of manualAdditionalVtuberHandles) {
    if (!handle) continue
    const profile = vtuberByHandle.get(handle.toLowerCase())
    if (profile) {
      vtuberDidSet.add(profile.did)
    }
  }
}

const markDidAsTeam = (did: string) => {
  if (!did) return
  const profile = ensureVtuberProfile(did)
  profile.isFrVtubersTeam = true
  frTeamDidSet.add(profile.did)
}

const markHandleAsTeam = (handle: string) => {
  if (!handle) return
  const profile = vtuberByHandle.get(handle.toLowerCase())
  if (profile) {
    markDidAsTeam(profile.did)
  }
}

const applyManualTeamOverrides = () => {
  for (const did of manualFrVtuberTeamDids) {
    markDidAsTeam(did)
  }
  for (const handle of manualFrVtuberTeamHandles) {
    markHandleAsTeam(handle)
  }
}

const recomputeTeamMembership = () => {
  frTeamDidSet.clear()
  for (const profile of vtuberByDid.values()) {
    const baseTeam = baseTeamFlagByDid.get(profile.did) ?? false
    profile.isFrVtubersTeam = baseTeam
    if (baseTeam) {
      frTeamDidSet.add(profile.did)
      continue
    }

    if (matchesTeamLogin(profile)) {
      profile.isFrVtubersTeam = true
      frTeamDidSet.add(profile.did)
      continue
    }
  }
  applyManualTeamOverrides()
}

export const updateFrVtubersTeam = (
  members: FrVtubersTeamMember[],
  generatedAt?: string,
) => {
  currentTeamMembers = members.map((member) => ({ ...member }))
  frTeamLogins.clear()
  frTeamNormalizedLogins.clear()
  for (const member of members) {
    if (!member.userLogin) continue
    const loginLc = member.userLogin.toLowerCase()
    frTeamLogins.add(loginLc)
    const normalized = normalizeIdentifier(loginLc)
    if (normalized) {
      frTeamNormalizedLogins.add(normalized)
    }
  }
  frTeamLoginsList = Array.from(frTeamLogins)
  frTeamNormalizedLoginsList = Array.from(frTeamNormalizedLogins)
  if (generatedAt) {
    currentTeamGeneratedAt = generatedAt
  }
  lastTeamRefreshIso = new Date().toISOString()
  recomputeTeamMembership()
}

export const getFrVtubersTeamMembers = (): ReadonlyArray<FrVtubersTeamMember> =>
  currentTeamMembers

export const getFrVtubersTeamGeneratedAt = (): string | undefined =>
  currentTeamGeneratedAt

export const getFrVtubersTeamLastRefresh = (): string | undefined =>
  lastTeamRefreshIso

initializeFromCatalog()
applyManualVtuberOverrides()
updateFrVtubersTeam(generatedTeamMembers, frVtubersTeamGeneratedAt)

export const baselineTextKeywords = [
  'vtuber',
  'vtubeuse',
  'vtubeur',
  'vtubing',
  'vtubbing',
  'vtb',
  'vtuberfr',
  'frvtuber',
  'frvtubers',
  'vtuber fr',
  'vtubeuse fr',
  'vtubeur fr',
  'vtuber français',
  'vtuber francaise',
  'vtuber française',
  'vtuber qc',
  'vtuberqc',
  'qcvtuber',
  'vtbfr',
] as const

export const baselineRegexKeywords = [
  /\bvtuberfr\b/i,
  /\bfrvtubers\b/i,
  /\bfrvtuber\b/i,
  /\bvtubersfr\b/i,
  /\bvtuberqc\b/i,
  /\bqcvtuber\b/i,
  /\bvtubeurfr\b/i,
  /\bvtubeusefr\b/i,
  /\bvtbfr\b/i,
] as const

const textKeywordsFromCatalog = new Set<string>()
for (const profile of vtuberCatalog) {
  for (const term of profile.matchedTerms ?? []) {
    if (!term) continue
    textKeywordsFromCatalog.add(term.toLowerCase())
  }
}

export const vtuberTextKeywords = [
  ...new Set([
    ...baselineTextKeywords.map((keyword) => keyword.toLowerCase()),
    ...Array.from(textKeywordsFromCatalog),
  ]),
]

export const isKnownVtuberDid = (did: string): boolean =>
  vtuberDidSet.has(did)

export const isFrVtuberTeamDid = (did: string): boolean =>
  frTeamDidSet.has(did)

export const getAuthorPriority = (did: string): number => {
  if (isFrVtuberTeamDid(did)) {
    return 2
  }
  if (isKnownVtuberDid(did)) {
    return 1
  }
  return 0
}

export const getVtuberProfile = (
  did: string,
): VtuberProfile | undefined => vtuberByDid.get(did)

function matchesTeamLogin(profile: VtuberProfile): boolean {
  const { exact, normalized } = collectIdentifierCandidates(profile)

  for (const candidate of exact) {
    if (frTeamLogins.has(candidate)) {
      return true
    }
  }

  for (const candidate of normalized) {
    if (frTeamNormalizedLogins.has(candidate)) {
      return true
    }
  }

  for (const candidate of exact) {
    if (!candidate) continue
    for (const login of frTeamLoginsList) {
      if (!login) continue
      if (candidate.includes(login) || login.includes(candidate)) {
        return true
      }
    }
  }

  for (const candidate of normalized) {
    if (!candidate) continue
    for (const login of frTeamNormalizedLoginsList) {
      if (!login) continue
      if (candidate.includes(login) || login.includes(candidate)) {
        return true
      }
    }
  }

  return false
}

function collectIdentifierCandidates(profile: VtuberProfile) {
  const exact = new Set<string>()
  const normalized = new Set<string>()

  const push = (value?: string) => {
    if (!value) return
    const trimmed = value.trim()
    if (!trimmed) return
    const lower = trimmed.toLowerCase()
    if (!lower) return
    exact.add(lower)
    const norm = normalizeIdentifier(lower)
    if (norm) {
      normalized.add(norm)
    }
  }

  push(profile.twitchLogin)
  push(profile.handle)
  push(extractHandleLocalPart(profile.handle))

  if (profile.displayName) {
    push(profile.displayName)
    for (const token of profile.displayName.split(/[\s\-_]+/)) {
      push(token)
    }
  }

  return { exact, normalized }
}

function extractHandleLocalPart(handle?: string): string | undefined {
  if (!handle) return undefined
  const base = handle.includes('@')
    ? handle.slice(handle.indexOf('@') + 1)
    : handle
  const local = base.split('.')[0]
  const trimmed = local.trim()
  if (!trimmed) return undefined
  return trimmed
}

function normalizeIdentifier(value: string): string | undefined {
  if (!value) return undefined
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!normalized) return undefined
  return normalized
}

const frenchSignalStrings = [
  'frvtuber',
  'frvtubers',
  'fr vtuber',
  'vtuber fr',
  'vtubeur',
  'vtubeuse',
  'vtbfr',
  'vtuber français',
  'vtuber francaise',
  'vtuber française',
  'vtubeur fr',
  'vtubeuse fr',
  'qcvtuber',
  'vtuberqc',
  '#frvtuber',
  '#frvtubers',
  '#vtuberfr',
  '#vtbfr',
  '#qcvtuber',
  '#vtuberqc',
] as const

const frenchSignalRegexes = [
  /\bfr[\s\-]?vtuber[s]?\b/i,
  /\bvtuber[\s\-]?fr\b/i,
  /\bvtubeur[s]?\b/i,
  /\bvtubeuse[s]?\b/i,
  /\bqcvtuber[s]?\b/i,
  /\bvtuberqc\b/i,
  /\bvtuber\s*français\b/i,
  /\bvtuber\s*francaise\b/i,
  /\bvtuber\s*française\b/i,
] as const

export const hasFrenchSignal = (text: string | undefined): boolean => {
  if (!text) return false
  const lower = text.toLowerCase()
  if (frenchSignalStrings.some((keyword) => lower.includes(keyword))) {
    return true
  }
  return frenchSignalRegexes.some((regex) => regex.test(text))
}
