import { Injectable } from "some-di";
import { User, CreateUserDto } from "./types";
import { UserRepository } from "./repository";

/**
 * Service responsible for user management operations.
 */
export class UserService {
  private readonly cache = new Map<string, User>();

  constructor(private readonly repo: UserRepository) {}

  async findById(id: string): Promise<User | null> {
    if (this.cache.has(id)) return this.cache.get(id)!;
    const user = await this.repo.findOne(id);
    if (user) this.cache.set(id, user);
    return user;
  }

  async create(dto: CreateUserDto): Promise<User> {
    const user = await this.repo.create(dto);
    this.cache.set(user.id, user);
    return user;
  }

  async delete(id: string): Promise<void> {
    this.cache.delete(id);
    await this.repo.delete(id);
  }
}
