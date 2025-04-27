const userSessions = new Map<string, any>();

export function getSession(userId: string): any {
    return userSessions.get(userId);
}

export function setSession(userId: string, sessionData: any): void {
    userSessions.set(userId, sessionData);
}

export function clearSession(userId: string): void {
    userSessions.delete(userId);
}
