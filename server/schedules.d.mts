import type { OfficeSchedule, ScheduleInput } from '../src/types'

export const SCHEDULE_REPEATS: readonly OfficeSchedule['repeat'][]
export const MAX_SCHEDULES: number
export const MIN_INTERVAL_MINUTES: number
export const MAX_INTERVAL_MINUTES: number
export function validateSchedule(input: unknown): string | null
export function computeNextRun(schedule: Pick<OfficeSchedule, 'repeat' | 'runAt' | 'intervalMinutes' | 'time' | 'days' | 'lastRunAt'>, after?: Date): string | null
export function makeSchedule(input: ScheduleInput, id: string, now?: Date, previous?: OfficeSchedule | null): OfficeSchedule
export function staleOnceSchedule(input: ScheduleInput, now?: Date): boolean
export function isDue(schedule: OfficeSchedule, now?: Date): boolean
export function recordRun(schedule: OfficeSchedule, outcome: { status: 'launched' | 'waiting' | 'failed'; message?: string; taskId?: string }, now?: Date): OfficeSchedule
export function validStoredSchedules(value: unknown): value is OfficeSchedule[]
export function migrateSchedules(value: unknown): unknown
export function describeRepeat(schedule: Pick<OfficeSchedule, 'repeat' | 'intervalMinutes' | 'time' | 'days'>): string
