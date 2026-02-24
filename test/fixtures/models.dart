import 'package:freezed_annotation/freezed_annotation.dart';

part 'models.freezed.dart';
part 'models.g.dart';

/// User model with freezed code generation.
@freezed
class User with _$User {
  const factory User({
    required String id,
    required String name,
    String? email,
    @Default(UserRole.member) UserRole role,
  }) = _User;

  factory User.fromJson(Map<String, dynamic> json) => _$UserFromJson(json);
}

/// Available roles for a user.
enum UserRole {
  admin,
  member,
  guest;

  String get displayName => name[0].toUpperCase() + name.substring(1);
}

/// Mixin providing validation logic for models.
mixin Validatable {
  bool validate();

  String? get validationError {
    return validate() ? null : 'Validation failed';
  }
}

typedef UserMap = Map<String, User>;

/// Extension on String providing name formatting utilities.
extension StringFormatting on String {
  String toTitleCase() {
    if (isEmpty) return this;
    return split(' ').map((word) {
      if (word.isEmpty) return word;
      return word[0].toUpperCase() + word.substring(1).toLowerCase();
    }).join(' ');
  }

  String get initials {
    return split(' ').where((w) => w.isNotEmpty).map((w) => w[0].toUpperCase()).join();
  }
}
