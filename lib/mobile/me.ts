export interface MeResponse {
  user: {
    id: string;
    username: string | null;
    displayName: string | null;
    email: string | null;
    avatarUrl: string | null;
  };
}

export type ProfileRow = {
  id: string;
  username: string | null;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
};

/** Who's signed in, for the app: the database row with camelCase keys, nothing else. */
export function meResponse(row: ProfileRow): MeResponse {
  return {
    user: {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      email: row.email,
      avatarUrl: row.avatar_url,
    },
  };
}
