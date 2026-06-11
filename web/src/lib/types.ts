export type EventType =
  | "ctf"
  | "cfp"
  | "conference"
  | "training"
  | "village"
  | "bugbounty"
  | "meetup"
  | "workshop";

export interface SecurityEvent {
  id: number;
  name: string;
  eventType: EventType;
  subtype: string | null;
  country: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  venue: string | null;
  isOnline: boolean;
  dedicatedSecurity: boolean;
  audience: string | null;
  eventStart: string | null;
  eventEnd: string | null;
  cfpCloses: string | null;
  deadline: string | null;
  description: string;
  topics: string[];
  primaryUrl: string;
  registrationUrl: string | null;
}
