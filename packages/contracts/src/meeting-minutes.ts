export type MeetingAttendee = { residentId: string; unitId: string; fullName: string; blockName: string; flatNumber: string }
export type MeetingSummary = { id: string; title: string; meetingAt: string | null; publishedAt: string | null; status: 'draft' | 'published'; attendeeCount: number }
export type MeetingDetail = MeetingSummary & {
  location: string; notes: string; attendanceNotRecorded: boolean; timezone: string
  attendees: Array<Pick<MeetingAttendee, 'fullName' | 'blockName' | 'flatNumber'>>
}
export type AdminMeetingDetail = Omit<MeetingDetail, 'attendees'> & { attendees: MeetingAttendee[]; version: number; reviewFingerprint: string }
export type MeetingDraft = { title: string; meetingAt: string | null; location: string; notes: string; attendeeIds: string[]; attendanceNotRecorded: boolean }
export type MeetingHistory = { items: MeetingSummary[]; nextCursor: string | null }
export type MeetingList = { items: MeetingSummary[]; total: number; page: number; pageSize: number }
export type MeetingRoster = { items: MeetingAttendee[]; total: number; page: number; pageSize: number }
