export const normalizeTicketId = (ticketId?: string | null): string | null => {
  const normalized = ticketId?.trim();
  return normalized || null;
};

export const parseTicketRecord = <T>(raw: string): T | null => {
  try {
    return JSON.parse(raw) as T;
  } catch (_error) {
    return null;
  }
};
