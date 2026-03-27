import React, { createContext, useContext, useState, ReactNode } from 'react';
import { useEffect } from 'react';
import { getToken, setToken } from '../../lib/api';
import { api } from '../../lib/api';

export type OrgType = 'Government' | 'Other ORG' | 'Unified Account';

export interface User {
  pid: string;
  email?: string;
  mobile?: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  state?: string;
  country?: string;
}

export interface Identity {
  id: string;
  type: OrgType;
  orgId?: string;
  personalOrgId?: string;
  epicId?: string;
  displayName: string;
}

export interface Organization {
  id: string;
  name: string;
  orgId: string;
  userOrgId: string;
  userRole: 'Organizer' | 'Voter';
  userScope: number;
  participants: Participant[];
  scopeTree: ScopeNode;
}

export interface Participant {
  id: string;
  personalId: string;
  contact: string;
  role: 'Organizer' | 'Voter';
  scope: number;
}

export interface ScopeNode {
  id: string;
  name: string;
  scope: number;
  children: ScopeNode[];
}

export interface Candidate {
  id: string;
  name: string;
  bio?: string;
  imageUrl?: string;
}

export interface VotingEvent {
  id: string;
  title: string;
  description: string;
  organizer: string;
  organizationId: string;
  scopeLevel: number;
  startDate: Date;
  endDate: Date;
  candidates: Candidate[];
  enableLiveData: boolean;
  restrictVisibility: boolean;
  status: 'active' | 'voted' | 'completed';
  userVoted?: boolean;
  votes?: Record<string, number>;
}

interface AppContextType {
  user: User | null;
  setUser: (user: User | null) => void;
  identities: Identity[];
  addIdentity: (identity: Identity) => void;
  activeIdentity: Identity | null;
  setActiveIdentity: (identity: Identity | null) => void;
  organizations: Organization[];
  addOrganization: (org: Organization) => void;
  updateOrganization: (orgId: string, updates: Partial<Organization>) => void;
  events: VotingEvent[];
  addEvent: (event: VotingEvent) => void;
  updateEvent: (eventId: string, updates: Partial<VotingEvent>) => void;
  voteOnEvent: (eventId: string, candidateId: string) => void;
  loading: boolean;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within AppProvider');
  }
  return context;
};

export const AppProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

useEffect(() => {
  if (!getToken()) { setLoading(false); return; }
  (api.getMe() as Promise<any>)
    .then(data => setUser({
      pid: String(data.pid ?? ''),
      firstName: data.first_name,
      middleName: data.middle_name,
      lastName: data.last_name,
      email: data.email,
      mobile: data.mobile,
      state: data.state,
      country: data.country,
    }))
    .catch(() => { setToken(null); })
    .finally(() => setLoading(false));
}, []);
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [activeIdentity, setActiveIdentity] = useState<Identity | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [events, setEvents] = useState<VotingEvent[]>([]);

  const addIdentity = (identity: Identity) => {
    setIdentities([...identities, identity]);
  };

  const addOrganization = (org: Organization) => {
    setOrganizations([...organizations, org]);
  };

  const updateOrganization = (orgId: string, updates: Partial<Organization>) => {
    setOrganizations(orgs =>
      orgs.map(org => (org.id === orgId ? { ...org, ...updates } : org))
    );
  };

  const addEvent = (event: VotingEvent) => {
    setEvents([...events, event]);
  };

  const updateEvent = (eventId: string, updates: Partial<VotingEvent>) => {
    setEvents(evts =>
      evts.map(evt => (evt.id === eventId ? { ...evt, ...updates } : evt))
    );
  };

  const voteOnEvent = (eventId: string, candidateId: string) => {
    setEvents(evts =>
      evts.map(evt => {
        if (evt.id === eventId) {
          const votes = { ...evt.votes };
          votes[candidateId] = (votes[candidateId] || 0) + 1;
          return {
            ...evt,
            userVoted: true,
            status: 'voted' as const,
            votes,
          };
        }
        return evt;
      })
    );
  };

  return (
    <AppContext.Provider
      value={{
        user,
        setUser,
        identities,
        addIdentity,
        activeIdentity,
        setActiveIdentity,
        organizations,
        addOrganization,
        updateOrganization,
        events,
        addEvent,
        updateEvent,
        voteOnEvent,
        loading,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};
