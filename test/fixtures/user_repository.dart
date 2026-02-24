import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import './models.dart';

/// Base repository interface for CRUD operations.
abstract class Repository<T> {
  Future<T?> getById(String id);
  Future<List<T>> getAll();
  Future<void> save(T item);
  Future<void> delete(String id);
}

/// Concrete repository for user data with caching support.
class UserRepository extends Repository<User> {
  final Map<String, User> _cache = {};

  @override
  Future<User?> getById(String id) async {
    if (_cache.containsKey(id)) {
      return _cache[id];
    }
    final user = await _fetchFromApi(id);
    if (user != null) {
      _cache[id] = user;
    }
    return user;
  }

  @override
  Future<List<User>> getAll() async {
    final users = await _fetchAllFromApi();
    for (final user in users) {
      _cache[user.id] = user;
    }
    return users;
  }

  @override
  Future<void> save(User item) async {
    _cache[item.id] = item;
    await _saveToApi(item);
  }

  @override
  Future<void> delete(String id) async {
    _cache.remove(id);
    await _deleteFromApi(id);
  }

  Future<User?> _fetchFromApi(String id) async => null;
  Future<List<User>> _fetchAllFromApi() async => [];
  Future<void> _saveToApi(User user) async {}
  Future<void> _deleteFromApi(String id) async {}
}

final userRepositoryProvider = Provider<UserRepository>((ref) {
  return UserRepository();
});
