import type { NoteInput, OfficeNote } from '../src/types'

export const MAX_NOTES: number
export const MAX_DRAFTS: number
export const LIMITS: { title: number; body: number; tags: number; tag: number; files: number; file: number }
export const CONTEXT_NOTES: number
export const CONTEXT_MIN_SCORE: number
export const AGENT_GUIDANCE: string
export const MCP_GUIDANCE: string
export function normalizeTag(value: unknown): string
export function normalizeFile(value: unknown): string
export function validateNoteInput(input: unknown): string | null
export function makeNote(input: Partial<NoteInput> & { status?: OfficeNote['status'] }, options?: { id?: string; workspace?: string; now?: Date; status?: OfficeNote['status']; source?: OfficeNote['source']; agentId?: string | null; taskId?: string | null }, previous?: OfficeNote | null): OfficeNote
export function validStoredNotes(value: unknown): value is OfficeNote[]
export function capNotes(notes: OfficeNote[]): OfficeNote[]
export function projectName(workspace: string | null | undefined): string
export function fileNodeId(workspace: string | null | undefined, file: string): string
export function searchTerms(query: string): string[]
export function scoreNote(note: OfficeNote, terms: string[]): number
export function searchNotes(notes: OfficeNote[], query: string, options?: { limit?: number; drafts?: boolean; workspace?: string | null }): { note: OfficeNote; score: number }[]
export function relevantNotes(notes: OfficeNote[], prompt: string, workspace?: string | null): OfficeNote[]
export function knowledgeContext(notes: OfficeNote[], workspace?: string | null): string
export function extractKnowledgeNote(reply: unknown): { title: string; body: string; tags: string[]; files: string[] } | null
export type KnowledgeGraphNode = { id: string; kind: 'note' | 'tag' | 'file' | 'project'; label: string; degree: number; noteId?: string; agentId?: string | null; status?: OfficeNote['status']; path?: string; workspace?: string }
export function projectNodeId(workspace: string | null | undefined): string
export function knowledgeGraph(notes: OfficeNote[], options?: { projects?: boolean }): { nodes: KnowledgeGraphNode[]; links: { source: string; target: string }[] }
