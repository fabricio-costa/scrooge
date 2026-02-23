/** Represents a registered user in the system. */
export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: Date;
}

export type CreateUserDto = Omit<User, "id" | "createdAt">;

export enum UserRole {
  Admin = "ADMIN",
  Member = "MEMBER",
  Guest = "GUEST",
}

export type UserFilter = {
  role?: UserRole;
  search?: string;
  limit?: number;
};

export const DEFAULT_PAGE_SIZE = 20;
