/** Public-safe user shape. Never includes passwordHash or token data. */
export function presentUser(user, roles = [], permissions = []) {
  return {
    id: user.id.toString(),
    phone: user.phone,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    avatarUrl: user.avatarUrl,
    locale: user.locale,
    status: user.status,
    phoneVerified: Boolean(user.phoneVerifiedAt),
    phoneVerifiedAt: user.phoneVerifiedAt,
    roles,
    permissions: [...permissions].sort(),
    createdAt: user.createdAt,
  };
}

/** Name shown to other users in bid lists: "Abebe K." */
export function publicDisplayName(user) {
  return `${user.firstName} ${user.lastName ? `${user.lastName[0]}.` : ''}`.trim();
}
