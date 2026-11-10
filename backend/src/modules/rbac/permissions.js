// Single source of truth for roles and permissions. The seed writes these to MySQL;
// admins can later change role_permissions rows without a code change.

export const ROLES = Object.freeze({
  GUEST: 'guest', // not assigned to accounts; documents what unauthenticated visitors can do (public routes)
  BUYER: 'buyer',
  BIDDER: 'bidder',
  SELLER: 'seller',
  AUCTION_ADMIN: 'auction_admin',
  SUPER_ADMIN: 'super_admin',
});

export const PERMISSIONS = Object.freeze({
  // buyer
  PROFILE_MANAGE: 'profile:manage',
  WATCHLIST_MANAGE: 'watchlist:manage',
  NOTIFICATION_READ: 'notification:read',
  SELLER_APPLY: 'seller:apply',
  // verified bidder
  BID_PLACE: 'bid:place',
  PAYMENT_MAKE: 'payment:make',
  // seller
  LISTING_MANAGE: 'listing:manage',
  AUCTION_CREATE: 'auction:create',
  SELLER_DASHBOARD: 'seller:dashboard',
  // auction admin
  ADMIN_ACCESS: 'admin:access',
  SELLER_REVIEW: 'seller:review',
  AUCTION_REVIEW: 'auction:review',
  AUCTION_CANCEL: 'auction:cancel',
  PRODUCT_MANAGE: 'product:manage',
  CATEGORY_MANAGE: 'category:manage',
  BID_MONITOR: 'bid:monitor',
  PAYMENT_VIEW: 'payment:view',
  PAYMENT_RECONCILE: 'payment:reconcile',
  REFUND_MANAGE: 'refund:manage',
  PAYOUT_MANAGE: 'payout:manage',
  REPORT_VIEW: 'report:view',
  USER_VIEW: 'user:view',
  // super admin only
  USER_MANAGE: 'user:manage',
  ROLE_ASSIGN: 'role:assign',
  SETTINGS_MANAGE: 'settings:manage',
  AUDIT_VIEW: 'audit:view',
});

export const PERMISSION_DESCRIPTIONS = Object.freeze({
  'profile:manage': 'Edit own profile and devices',
  'watchlist:manage': 'Add and remove auctions from own watchlist',
  'notification:read': 'Read own notifications',
  'seller:apply': 'Apply to become a seller',
  'bid:place': 'Place bids (requires verified phone)',
  'payment:make': 'Pay for won auctions and deposits',
  'listing:manage': 'Create and edit own product listings',
  'auction:create': 'Create and schedule own auctions',
  'seller:dashboard': 'View own sales, earnings and payouts',
  'admin:access': 'Open the admin dashboard',
  'seller:review': 'Approve or reject seller applications',
  'auction:review': 'Approve or reject auction listings',
  'auction:cancel': 'Cancel or suspend auctions',
  'product:manage': 'Edit or remove any product',
  'category:manage': 'Manage categories and banners',
  'bid:monitor': 'View all bids and bidding activity',
  'payment:view': 'View payments and webhooks',
  'payment:reconcile': 'Re-verify and reconcile payments',
  'refund:manage': 'Approve and record refunds',
  'payout:manage': 'Release and record seller payouts',
  'report:view': 'View dashboards and export reports',
  'user:view': 'View user accounts',
  'user:manage': 'Suspend, ban or reactivate users',
  'role:assign': 'Assign and remove roles',
  'settings:manage': 'Change platform settings',
  'audit:view': 'View audit logs',
});

const P = PERMISSIONS;
const buyer = [P.PROFILE_MANAGE, P.WATCHLIST_MANAGE, P.NOTIFICATION_READ, P.SELLER_APPLY];
const bidder = [P.BID_PLACE, P.PAYMENT_MAKE];
const seller = [P.LISTING_MANAGE, P.AUCTION_CREATE, P.SELLER_DASHBOARD];
const auctionAdmin = [
  P.ADMIN_ACCESS, P.SELLER_REVIEW, P.AUCTION_REVIEW, P.AUCTION_CANCEL, P.PRODUCT_MANAGE, P.CATEGORY_MANAGE,
  P.BID_MONITOR, P.PAYMENT_VIEW, P.PAYMENT_RECONCILE, P.REFUND_MANAGE, P.PAYOUT_MANAGE, P.REPORT_VIEW, P.USER_VIEW,
];

/** Roles are additive on an account: a verified seller holds buyer + bidder + seller. */
export const ROLE_DEFINITIONS = Object.freeze([
  { code: ROLES.GUEST, name: 'Guest visitor', description: 'Unauthenticated browsing (public routes only)', permissions: [] },
  { code: ROLES.BUYER, name: 'Registered buyer', description: 'Every registered account', permissions: buyer },
  { code: ROLES.BIDDER, name: 'Verified bidder', description: 'Granted when the phone number is verified', permissions: bidder },
  { code: ROLES.SELLER, name: 'Seller', description: 'Granted when a seller application is approved', permissions: seller },
  { code: ROLES.AUCTION_ADMIN, name: 'Auction administrator', description: 'Day-to-day marketplace operations', permissions: auctionAdmin },
  { code: ROLES.SUPER_ADMIN, name: 'Super administrator', description: 'Full access', permissions: Object.values(P) },
]);
