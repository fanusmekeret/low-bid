import 'package:flutter/widgets.dart';

import '../network/api_exception.dart';

/// All app text in English and Amharic. Amharic: have a native speaker review before launch.
/// Usage: `final s = S.of(context); Text(s.placeBid)`.
class S {
  const S(this.lang);

  final String lang;

  static S of(BuildContext context) => S(Localizations.localeOf(context).languageCode);

  static const supported = ['en', 'am'];

  String _t(String key) => (lang == 'am' ? am[key] : null) ?? en[key] ?? key;

  // ── General ──
  String get appName => _t('appName');
  String get tagline => _t('tagline');
  String get retry => _t('retry');
  String get all => _t('all');
  String get camera => _t('camera');
  String get gallery => _t('gallery');
  String get tinInvalid => _t('tinInvalid');
  String get conditionLabel => _t('conditionLabel');
  String get cancel => _t('cancel');
  String get save => _t('save');
  String get continueLabel => _t('continueLabel');
  String get done => _t('done');
  String get close => _t('close');
  String get delete => _t('delete');
  String get edit => _t('edit');
  String get submit => _t('submit');
  String get optional => _t('optional');
  String get requiredField => _t('required');
  String get seeAll => _t('seeAll');
  String get somethingWrong => _t('somethingWrong');
  String get nothingHere => _t('nothingHere');
  String get signIn => _t('signIn');
  String get signOut => _t('signOut');
  String get signInToContinue => _t('signInToContinue');

  // ── Onboarding and auth ──
  String get chooseLanguage => _t('chooseLanguage');
  String get welcomeTitle => _t('welcomeTitle');
  String get welcomeBody => _t('welcomeBody');
  String get getStarted => _t('getStarted');
  String get browseAsGuest => _t('browseAsGuest');
  String get login => _t('login');
  String get register => _t('register');
  String get phone => _t('phone');
  String get phoneHint => _t('phoneHint');
  String get phoneInvalid => _t('phoneInvalid');
  String get password => _t('password');
  String get firstName => _t('firstName');
  String get lastName => _t('lastName');
  String get emailOptional => _t('emailOptional');
  String get createAccount => _t('createAccount');
  String get haveAccount => _t('haveAccount');
  String get noAccount => _t('noAccount');
  String get forgotPassword => _t('forgotPassword');
  String get sendCode => _t('sendCode');
  String get verifyPhone => _t('verifyPhone');
  String codeSentTo(String to) => _t('codeSentTo').replaceAll('{to}', to);
  String get enterCode => _t('enterCode');
  String get verify => _t('verify');
  String get resendCode => _t('resendCode');
  String resendIn(int seconds) => _t('resendIn').replaceAll('{s}', '$seconds');
  String get resetPassword => _t('resetPassword');
  String get newPassword => _t('newPassword');
  String get passwordRules => _t('passwordRules');
  String get passwordUpdated => _t('passwordUpdated');
  String get verifyLater => _t('verifyLater');
  String get verifyToBid => _t('verifyToBid');

  // ── Navigation and home ──
  String get navHome => _t('navHome');
  String get navSearch => _t('navSearch');
  String get navMyBids => _t('navMyBids');
  String get navAccount => _t('navAccount');
  String get searchHint => _t('searchHint');
  String get featured => _t('featured');
  String get liveNow => _t('liveNow');
  String get endingSoon => _t('endingSoon');
  String get upcoming => _t('upcoming');
  String get recentlyAdded => _t('recentlyAdded');
  String get popularCategories => _t('popularCategories');
  String get noAuctionsYet => _t('noAuctionsYet');

  // ── Search ──
  String get statusOpen => _t('statusOpen');
  String get statusLive => _t('statusLive');
  String get statusUpcoming => _t('statusUpcoming');
  String get statusEnded => _t('statusEnded');
  String get allCategories => _t('allCategories');
  String get anyCondition => _t('anyCondition');
  String get sortBy => _t('sortBy');
  String get sortEndingSoon => _t('sortEndingSoon');
  String get sortNewest => _t('sortNewest');
  String get sortMostBids => _t('sortMostBids');
  String get sortStartingSoon => _t('sortStartingSoon');
  String get noResults => _t('noResults');
  String resultsCount(int n) => _t('resultsCount').replaceAll('{n}', '$n');

  String condition(String code) => _t('condition.$code');
  String bids(int n) => n == 1 ? _t('bidOne') : _t('bidMany').replaceAll('{n}', '$n');

  // ── Auction page ──
  String get placeBid => _t('placeBid');
  String get noBidsYet => _t('noBidsYet');
  String get specifications => _t('specifications');
  String get description => _t('description');
  String get seller => _t('seller');
  String get auctionEnded => _t('auctionEnded');
  String get auctionCancelled => _t('auctionCancelled');
  String get noSale => _t('noSale');
  String get watch => _t('watch');
  String get watching => _t('watching');
  String get yourListing => _t('yourListing');
  String get you => _t('you');
  String get startsSoon => _t('startsSoon');

  // ── Bid sheet ──
  String get yourBid => _t('yourBid');
  String minimumIs(String amount) => _t('minimumIs').replaceAll('{amount}', amount);
  String get bidPlaced => _t('bidPlaced');
  String get amountInvalid => _t('amountInvalid');

  // ── My bids, won, watchlist, notifications ──
  String get active => _t('active');
  String get ended => _t('ended');
  String myStatus(String code) => _t('myStatus.$code');
  String get noBidsMade => _t('noBidsMade');
  String get wonAuctions => _t('wonAuctions');
  String get payNow => _t('payNow');
  String payBy(String when) => _t('payBy').replaceAll('{when}', when);
  String get paid => _t('paid');
  String get viewReceipt => _t('viewReceipt');
  String get confirmReceived => _t('confirmReceived');
  String get confirmReceivedBody => _t('confirmReceivedBody');
  String get received => _t('received');
  String get amountDue => _t('amountDue');
  String get requestRefund => _t('requestRefund');
  String get refundReason => _t('refundReason');
  String get refundRequested => _t('refundRequested');
  String resultStatus(String code) => _t('result.$code');
  String get watchlist => _t('watchlist');
  String get noWatchlist => _t('noWatchlist');
  String get notifications => _t('notifications');
  String get markAllRead => _t('markAllRead');
  String get noNotifications => _t('noNotifications');

  // ── Account and settings ──
  String get account => _t('account');
  String get myBids => _t('myBids');
  String get payments => _t('payments');
  String get settings => _t('settings');
  String get language => _t('language');
  String get theme => _t('theme');
  String get themeSystem => _t('themeSystem');
  String get themeLight => _t('themeLight');
  String get themeDark => _t('themeDark');
  String get editProfile => _t('editProfile');
  String get phoneVerified => _t('phoneVerified');
  String get phoneNotVerified => _t('phoneNotVerified');
  String get verifyNow => _t('verifyNow');
  String get becomeSeller => _t('becomeSeller');
  String get sellerDashboard => _t('sellerDashboard');
  String get guestTitle => _t('guestTitle');
  String get guestBody => _t('guestBody');
  String get signOutConfirm => _t('signOutConfirm');
  String get profileSaved => _t('profileSaved');

  // ── Payments ──
  String get confirmingPayment => _t('confirmingPayment');
  String get confirmingPaymentBody => _t('confirmingPaymentBody');
  String get paymentConfirmed => _t('paymentConfirmed');
  String get paymentFailed => _t('paymentFailed');
  String get paymentExpired => _t('paymentExpired');
  String get paymentRefunding => _t('paymentRefunding');
  String get tryAgain => _t('tryAgain');
  String get openCheckout => _t('openCheckout');
  String get receipt => _t('receipt');
  String get receiptNo => _t('receiptNo');
  String get totalPaid => _t('totalPaid');
  String get paymentHistory => _t('paymentHistory');
  String get noPayments => _t('noPayments');
  String purpose(String code) => _t('purpose.$code');

  // ── Lowest unique bid ──
  String get howItWorks => _t('howItWorks');
  String get howItWorksBody => _t('howItWorksBody');
  String get bidFee => _t('bidFee');
  String bidFeeEach(String amount) => _t('bidFeeEach').replaceAll('{amount}', amount);
  String bidRange(String min, String max) => _t('bidRange').replaceAll('{min}', min).replaceAll('{max}', max);
  String get itemValue => _t('itemValue');
  String get allowedBids => _t('allowedBids');
  String get yourBids => _t('yourBids');
  String yourBidsCount(int n) => n == 1 ? _t('yourBidsOne') : _t('yourBidsMany').replaceAll('{n}', '$n');
  String get feeNotPaid => _t('feeNotPaid');
  String get payFee => _t('payFee');
  String get bidSecretNote => _t('bidSecretNote');
  String payFeeAndBid(String fee) => _t('payFeeAndBid').replaceAll('{fee}', fee);
  String get bidAmountHint => _t('bidAmountHint');
  String get results => _t('results');
  String get winningBid => _t('winningBid');
  String get uniqueBid => _t('uniqueBid');
  String get sharedBid => _t('sharedBid');
  String resultsSummary(int paid, int unique) => _t('resultsSummary').replaceAll('{paid}', '$paid').replaceAll('{unique}', '$unique');
  String get bidsRevealedAtEnd => _t('bidsRevealedAtEnd');
  String get notEnoughBids => _t('notEnoughBids');
  String wonBy(String alias) => _t('wonBy').replaceAll('{alias}', alias);
  String get yourPrice => _t('yourPrice');
  String get yourPriceHint => _t('yourPriceHint');
  String get retailValue => _t('retailValue');
  String get feesCollected => _t('feesCollected');
  String get placeAnotherBid => _t('placeAnotherBid');
  String get bidLimitReached => _t('bidLimitReached');
  String get youWon => _t('youWon');
  String get seeResults => _t('seeResults');
  String paymentStatus(String code) => _t('paymentStatus.$code');
  String get paidWith => _t('paidWith');
  String get reference => _t('reference');

  // ── Seller ──
  String get sellerApply => _t('sellerApply');
  String get sellerApplyBody => _t('sellerApplyBody');
  String get businessName => _t('businessName');
  String get businessType => _t('businessType');
  String get individual => _t('individual');
  String get company => _t('company');
  String get tin => _t('tin');
  String get city => _t('city');
  String get address => _t('address');
  String get bio => _t('bio');
  String get payoutMethod => _t('payoutMethod');
  String get bankTransfer => _t('bankTransfer');
  String get telebirr => _t('telebirr');
  String get bank => _t('bank');
  String get accountName => _t('accountName');
  String get accountNumber => _t('accountNumber');
  String get telebirrNumber => _t('telebirrNumber');
  String get submitApplication => _t('submitApplication');
  String sellerStatus(String code) => _t('sellerStatus.$code');
  String sellerStatusBody(String code) => _t('sellerStatusBody.$code');
  String get missingDocuments => _t('missingDocuments');
  String missing(String code) => _t('missing.$code');
  String get documents => _t('documents');
  String get uploadDocument => _t('uploadDocument');
  String get documentType => _t('documentType');
  String document(String code) => _t('doc.$code');
  String docStatus(String code) => _t('docStatus.$code');
  String get myListings => _t('myListings');
  String get newListing => _t('newListing');
  String get editListing => _t('editListing');
  String get title => _t('title');
  String get category => _t('category');
  String get location => _t('location');
  String get highlights => _t('highlights');
  String get highlightsHint => _t('highlightsHint');
  String get specGroups => _t('specGroups');
  String get addGroup => _t('addGroup');
  String get addRow => _t('addRow');
  String get groupName => _t('groupName');
  String get label => _t('label');
  String get value => _t('value');
  String get photos => _t('photos');
  String get addPhotos => _t('addPhotos');
  String get photosAfterSave => _t('photosAfterSave');
  String get saveDraft => _t('saveDraft');
  String get submitForReview => _t('submitForReview');
  String listingStatus(String code) => _t('listingStatus.$code');
  String get scheduleAuction => _t('scheduleAuction');
  String get startsAt => _t('startsAt');
  String get duration => _t('duration');
  String get createAuction => _t('createAuction');
  String get auctionSubmitted => _t('auctionSubmitted');
  String get myAuctions => _t('myAuctions');
  String get earnings => _t('earnings');
  String get grossSales => _t('grossSales');
  String get commission => _t('commission');
  String get netEarnings => _t('netEarnings');
  String get paidOut => _t('paidOut');
  String get pendingPayout => _t('pendingPayout');
  String get onHold => _t('onHold');
  String get payouts => _t('payouts');
  String auctionStatus(String code) => _t('auctionStatus.$code');
  String rejectedBecause(String reason) => _t('rejectedBecause').replaceAll('{reason}', reason);
  String hours(int n) => _t('hours').replaceAll('{n}', '$n');
  String days(int n) => _t('days').replaceAll('{n}', '$n');

  /// User-facing text for an API error: translated when we know the code, else the server's message.
  String error(Object e) {
    if (e is ApiException) {
      final key = 'error.${e.code}';
      final known = (lang == 'am' ? am[key] : null) ?? en[key];
      return known ?? e.message;
    }
    return somethingWrong;
  }

  // ───────────────────────────── English ─────────────────────────────
  static const Map<String, String> en = {
    'appName': 'LOW BID',
    'tagline': 'Bid smart. Win big.',
    'retry': 'Retry',
    'all': 'All',
    'camera': 'Camera',
    'gallery': 'Gallery',
    'tinInvalid': 'TIN is 10 digits',
    'conditionLabel': 'Condition',
    'cancel': 'Cancel',
    'save': 'Save',
    'continueLabel': 'Continue',
    'done': 'Done',
    'close': 'Close',
    'delete': 'Delete',
    'edit': 'Edit',
    'submit': 'Submit',
    'optional': 'Optional',
    'required': 'Required',
    'seeAll': 'See all',
    'somethingWrong': 'Something went wrong',
    'nothingHere': 'Nothing here yet',
    'signIn': 'Sign in',
    'signOut': 'Sign out',
    'signInToContinue': 'Sign in to continue',
    'chooseLanguage': 'Choose your language',
    'welcomeTitle': 'Ethiopia’s online auction house',
    'welcomeBody': 'Phones, appliances, vehicles and more. Bid live, pay safely with Chapa.',
    'getStarted': 'Get started',
    'browseAsGuest': 'Browse first',
    'login': 'Sign in',
    'register': 'Create account',
    'phone': 'Phone number',
    'phoneHint': '09XX XXX XXX',
    'phoneInvalid': 'Enter a valid Ethiopian mobile number, e.g. 0912345678',
    'password': 'Password',
    'firstName': 'First name',
    'lastName': 'Last name',
    'emailOptional': 'Email (optional)',
    'createAccount': 'Create account',
    'haveAccount': 'Already have an account? Sign in',
    'noAccount': 'New to LOW BID? Create an account',
    'forgotPassword': 'Forgot password?',
    'sendCode': 'Send code',
    'verifyPhone': 'Verify your phone',
    'codeSentTo': 'We sent a 6-digit code to {to}',
    'enterCode': '6-digit code',
    'verify': 'Verify',
    'resendCode': 'Resend code',
    'resendIn': 'Resend in {s}s',
    'resetPassword': 'Reset password',
    'newPassword': 'New password',
    'passwordRules': 'At least 8 characters, with letters and numbers',
    'passwordUpdated': 'Password updated. Sign in with your new password.',
    'verifyLater': 'Later',
    'verifyToBid': 'Verify your phone number to bid',
    'navHome': 'Home',
    'navSearch': 'Search',
    'navMyBids': 'My bids',
    'navAccount': 'Account',
    'searchHint': 'Search phones, appliances, cars…',
    'featured': 'Featured',
    'liveNow': 'Live now',
    'endingSoon': 'Ending soon',
    'upcoming': 'Starting soon',
    'recentlyAdded': 'Recently added',
    'popularCategories': 'Popular categories',
    'noAuctionsYet': 'No auctions here yet. Check back soon.',
    'statusOpen': 'All open',
    'statusLive': 'Live',
    'statusUpcoming': 'Upcoming',
    'statusEnded': 'Ended',
    'allCategories': 'All categories',
    'anyCondition': 'Any condition',
    'sortBy': 'Sort',
    'sortEndingSoon': 'Ending soon',
    'sortNewest': 'Newest',
    'sortMostBids': 'Most bids',
    'sortStartingSoon': 'Starting soon',
    'noResults': 'No auctions match your search',
    'resultsCount': '{n} auctions',
    'condition.NEW': 'New',
    'condition.LIKE_NEW': 'Like new',
    'condition.USED_GOOD': 'Used, good',
    'condition.USED_FAIR': 'Used, fair',
    'condition.FOR_PARTS': 'For parts',
    'bidOne': '1 bid',
    'bidMany': '{n} bids',
    'placeBid': 'Place bid',
    'noBidsYet': 'No bids yet. Be the first.',
    'specifications': 'Specifications',
    'description': 'Description',
    'seller': 'Seller',
    'auctionEnded': 'This auction has ended',
    'auctionCancelled': 'This auction was cancelled',
    'howItWorks': 'How it works',
    'howItWorksBody': 'Pick any amount within the range. When the auction ends, the lowest amount that only one person bid wins, and the winner pays just that amount. Each bid costs a small fee. Bids are secret until the end.',
    'bidFee': 'Bid fee',
    'bidFeeEach': '{amount} per bid',
    'bidRange': 'Bids from {min} to {max}',
    'itemValue': 'Item value',
    'allowedBids': 'Allowed bids',
    'yourBids': 'Your bids',
    'yourBidsOne': 'You have 1 bid',
    'yourBidsMany': 'You have {n} bids',
    'feeNotPaid': 'Fee not paid',
    'payFee': 'Pay fee',
    'bidSecretNote': 'Your amount stays secret. Nobody, not even the seller, sees any bid until the auction ends.',
    'payFeeAndBid': 'Pay {fee} and bid',
    'bidAmountHint': 'e.g. 37.45',
    'results': 'Results',
    'winningBid': 'Winning bid',
    'uniqueBid': 'Unique',
    'sharedBid': 'Shared',
    'resultsSummary': '{paid} paid bids, {unique} unique amounts',
    'bidsRevealedAtEnd': 'All bids are revealed when the auction ends',
    'notEnoughBids': 'Not enough bids. Every bid fee is refunded.',
    'wonBy': 'Won by {alias}',
    'yourPrice': 'Your price',
    'yourPriceHint': 'What you receive for the item (less 10% commission), whatever the winning bid',
    'retailValue': 'Retail value (optional)',
    'feesCollected': 'Fees collected',
    'placeAnotherBid': 'Place another bid',
    'bidLimitReached': 'You have reached the bid limit for this auction',
    'youWon': 'You won!',
    'seeResults': 'See results',
    'myStatus.BIDDING': 'Bidding',
    'purpose.BID_FEE': 'Bid fee',
    'result.NOT_ENOUGH_BIDS': 'Not enough bids',
    'error.BID_OUT_OF_RANGE': 'That amount is outside the allowed range',
    'error.BID_STEP_INVALID': 'Use an amount in the allowed steps',
    'error.DUPLICATE_BID_AMOUNT': 'You already bid this amount. Choose a different one.',
    'error.BID_LIMIT_REACHED': 'You have reached the bid limit for this auction',
    'error.BIDS_SECRET': 'Bids are revealed when the auction ends',
    'noSale': 'Ended without a sale',
    'watch': 'Watch',
    'watching': 'Watching',
    'yourListing': 'This is your listing',
    'you': 'You',
    'startsSoon': 'Bidding opens soon',
    'yourBid': 'Your bid',
    'minimumIs': 'Minimum {amount}',
    'bidPlaced': 'Bid fee received. Your bid is in, and stays secret until the end.',
    'amountInvalid': 'Enter an amount in birr, e.g. 165000',
    'active': 'Active',
    'ended': 'Ended',
    'myStatus.LEADING': 'Leading',
    'myStatus.OUTBID': 'Outbid',
    'myStatus.WON': 'Won',
    'myStatus.LOST': 'Lost',
    'myStatus.CANCELLED': 'Cancelled',
    'noBidsMade': 'You have not bid on anything yet',
    'wonAuctions': 'Won auctions',
    'payNow': 'Pay now',
    'payBy': 'Pay by {when}',
    'paid': 'Paid',
    'viewReceipt': 'View receipt',
    'confirmReceived': 'I received the item',
    'confirmReceivedBody': 'Confirm only once you have the item. The seller will then be paid.',
    'received': 'Received',
    'amountDue': 'Amount due',
    'requestRefund': 'Request a refund',
    'refundReason': 'What went wrong?',
    'refundRequested': 'Refund requested. We will review it shortly.',
    'result.AWAITING_PAYMENT': 'Awaiting payment',
    'result.PAID': 'Paid',
    'result.FULFILLED': 'Completed',
    'result.DISPUTED': 'Refund requested',
    'result.PAYMENT_EXPIRED': 'Payment time ended',
    'result.CANCELLED': 'Cancelled',
    'watchlist': 'Watchlist',
    'noWatchlist': 'Tap Watch on an auction to follow it here',
    'notifications': 'Notifications',
    'markAllRead': 'Mark all read',
    'noNotifications': 'No notifications yet',
    'account': 'Account',
    'myBids': 'My bids',
    'payments': 'Payments',
    'settings': 'Settings',
    'language': 'Language',
    'theme': 'Appearance',
    'themeSystem': 'System',
    'themeLight': 'Light',
    'themeDark': 'Dark',
    'editProfile': 'Edit profile',
    'phoneVerified': 'Phone verified',
    'phoneNotVerified': 'Phone not verified',
    'verifyNow': 'Verify now',
    'becomeSeller': 'Sell on LOW BID',
    'sellerDashboard': 'Seller dashboard',
    'guestTitle': 'Welcome to LOW BID',
    'guestBody': 'Sign in to bid, watch auctions and see your wins.',
    'signOutConfirm': 'Sign out of LOW BID on this phone?',
    'profileSaved': 'Profile saved',
    'confirmingPayment': 'Confirming your payment',
    'confirmingPaymentBody': 'This usually takes a few seconds. You can leave this screen; we will notify you.',
    'paymentConfirmed': 'Payment confirmed',
    'paymentFailed': 'Payment not completed',
    'paymentExpired': 'This checkout expired',
    'paymentRefunding': 'We received your payment after the offer ended. It is being refunded.',
    'tryAgain': 'Try again',
    'openCheckout': 'Open Chapa checkout',
    'receipt': 'Receipt',
    'receiptNo': 'Receipt number',
    'totalPaid': 'Total paid',
    'paymentHistory': 'Payment history',
    'noPayments': 'No payments yet',
    'purpose.BID_DEPOSIT': 'Bid deposit',
    'purpose.WINNING_BID': 'Winning bid',
    'paymentStatus.INITIATED': 'Starting',
    'paymentStatus.PENDING': 'Pending',
    'paymentStatus.PAID': 'Paid',
    'paymentStatus.FAILED': 'Failed',
    'paymentStatus.EXPIRED': 'Expired',
    'paymentStatus.REFUNDED': 'Refunded',
    'paymentStatus.PARTIALLY_REFUNDED': 'Partly refunded',
    'paidWith': 'Paid with',
    'reference': 'Reference',
    'sellerApply': 'Become a seller',
    'sellerApplyBody': 'Tell us about your business. After we check your ID, you can list items.',
    'businessName': 'Business or display name',
    'businessType': 'You are selling as',
    'individual': 'Individual',
    'company': 'Company',
    'tin': 'TIN (10 digits)',
    'city': 'City',
    'address': 'Address',
    'bio': 'About you',
    'payoutMethod': 'How you get paid',
    'bankTransfer': 'Bank account',
    'telebirr': 'telebirr',
    'bank': 'Bank',
    'accountName': 'Account holder name',
    'accountNumber': 'Account number',
    'telebirrNumber': 'telebirr phone number',
    'submitApplication': 'Submit application',
    'sellerStatus.PENDING': 'Application under review',
    'sellerStatus.APPROVED': 'Approved seller',
    'sellerStatus.REJECTED': 'Application not approved',
    'sellerStatus.SUSPENDED': 'Seller account suspended',
    'sellerStatusBody.PENDING': 'We will review your documents shortly.',
    'sellerStatusBody.APPROVED': 'You can list items and schedule auctions.',
    'sellerStatusBody.REJECTED': 'Update your details or documents and apply again.',
    'sellerStatusBody.SUSPENDED': 'Contact LOW BID support.',
    'missingDocuments': 'Still needed',
    'missing.IDENTITY_DOCUMENT': 'An ID: Fayda, kebele ID, passport or driving licence',
    'missing.TRADE_LICENSE': 'Trade licence',
    'missing.TIN_NUMBER': 'TIN number',
    'documents': 'Verification documents',
    'uploadDocument': 'Upload document',
    'documentType': 'Document type',
    'doc.FAYDA_ID': 'Fayda ID',
    'doc.KEBELE_ID': 'Kebele ID',
    'doc.PASSPORT': 'Passport',
    'doc.DRIVING_LICENSE': 'Driving licence',
    'doc.TRADE_LICENSE': 'Trade licence',
    'doc.TIN_CERTIFICATE': 'TIN certificate',
    'docStatus.PENDING': 'In review',
    'docStatus.APPROVED': 'Approved',
    'docStatus.REJECTED': 'Rejected',
    'myListings': 'My listings',
    'newListing': 'New listing',
    'editListing': 'Edit listing',
    'title': 'Title',
    'category': 'Category',
    'location': 'Location',
    'highlights': 'Card highlights',
    'highlightsHint': 'Up to 3 short specs shown on the auction card, e.g. 256GB. No prices.',
    'specGroups': 'Specifications',
    'addGroup': 'Add section',
    'addRow': 'Add row',
    'groupName': 'Section, e.g. Display',
    'label': 'Label',
    'value': 'Value',
    'photos': 'Photos',
    'addPhotos': 'Add photos',
    'photosAfterSave': 'Save the draft first, then add photos.',
    'saveDraft': 'Save',
    'submitForReview': 'Submit for review',
    'listingStatus.DRAFT': 'Draft',
    'listingStatus.PENDING_REVIEW': 'In review',
    'listingStatus.APPROVED': 'Approved',
    'listingStatus.REJECTED': 'Needs changes',
    'listingStatus.ARCHIVED': 'Archived',
    'scheduleAuction': 'Schedule auction',
    'startsAt': 'Starts',
    'duration': 'Duration',
    'createAuction': 'Submit auction for approval',
    'auctionSubmitted': 'Auction submitted. We will approve it before it starts.',
    'myAuctions': 'My auctions',
    'earnings': 'Earnings',
    'grossSales': 'Sales',
    'commission': 'LOW BID fee (10%)',
    'netEarnings': 'Your earnings',
    'paidOut': 'Paid out',
    'pendingPayout': 'Coming',
    'onHold': 'On hold',
    'payouts': 'Payouts',
    'auctionStatus.PENDING_APPROVAL': 'Awaiting approval',
    'auctionStatus.SCHEDULED': 'Scheduled',
    'auctionStatus.LIVE': 'Live',
    'auctionStatus.CLOSED': 'Ended',
    'auctionStatus.CANCELLED': 'Cancelled',
    'rejectedBecause': 'Reason: {reason}',
    'hours': '{n} h',
    'days': '{n} days',
    'error.NETWORK_ERROR': 'No internet connection. Check your connection and try again.',
    'error.TIMEOUT': 'The connection is slow. Try again.',
    'error.AUTH_INVALID_CREDENTIALS': 'Incorrect phone number or password',
    'error.PHONE_TAKEN': 'An account with this phone number already exists',
    'error.OTP_INVALID': 'That code is incorrect',
    'error.OTP_EXPIRED': 'The code has expired. Request a new one.',
    'error.OTP_COOLDOWN': 'Please wait a moment before requesting another code',
    'error.ACCOUNT_SUSPENDED': 'Your account is suspended. Contact support.',
    'error.PHONE_NOT_VERIFIED': 'Verify your phone number first',
    'error.AUCTION_ENDED': 'This auction has ended',
    'error.AUCTION_NOT_STARTED': 'Bidding has not started yet',
    'error.SELLER_CANNOT_BID': 'You cannot bid on your own item',
    'error.ALREADY_LEADING': 'You already have the highest bid',
    'error.DEPOSIT_REQUIRED': 'Pay the refundable deposit to bid',
    'error.BID_TOO_LOW': 'Someone bid higher. Raise your bid.',
    'error.BID_TOO_HIGH': 'That is far above the minimum. Check the amount.',
    'error.BIDDING_BLOCKED': 'Bidding is blocked after unpaid wins. Contact support.',
    'error.RATE_LIMITED': 'Too fast. Wait a moment and try again.',
    'error.PAYMENT_INIT_FAILED': 'The payment could not start. Try again.',
    'error.PAYMENT_PROVIDER_UNAVAILABLE': 'Payments are unavailable right now. Try again soon.',
    'error.PAYMENT_DEADLINE_PASSED': 'The payment deadline has passed',
    'error.ALREADY_PAID': 'You have already paid for this item',
    'error.DEPOSIT_ALREADY_PAID': 'Your deposit is already paid',
    'error.PRODUCT_LOCKED': 'This listing has an auction in progress and cannot change',
    'error.IMAGE_TOO_SMALL': 'Photos must be at least 400 pixels on the shortest side',
    'error.IMAGE_TYPE_NOT_ALLOWED': 'Use JPEG or PNG photos',
    'error.FILE_TOO_LARGE': 'A file is too large (8 MB maximum)',
  };

  // ───────────────────────────── Amharic ─────────────────────────────
  static const Map<String, String> am = {
    'appName': 'LOW BID',
    'tagline': 'በብልሃት ይጫረቱ፣ በብዛት ያሸንፉ።',
    'retry': 'እንደገና ሞክር',
    'all': 'ሁሉም',
    'camera': 'ካሜራ',
    'gallery': 'የፎቶ ማህደር',
    'tinInvalid': 'የግብር ከፋይ መለያ ቁጥር 10 አሃዝ ነው',
    'conditionLabel': 'ሁኔታ',
    'cancel': 'ሰርዝ',
    'save': 'አስቀምጥ',
    'continueLabel': 'ቀጥል',
    'done': 'ተጠናቋል',
    'close': 'ዝጋ',
    'delete': 'አጥፋ',
    'edit': 'አስተካክል',
    'submit': 'አስገባ',
    'optional': 'አማራጭ',
    'required': 'የግድ ነው',
    'seeAll': 'ሁሉንም እይ',
    'somethingWrong': 'የሆነ ችግር ተፈጥሯል',
    'nothingHere': 'እስካሁን ምንም የለም',
    'signIn': 'ግባ',
    'signOut': 'ውጣ',
    'signInToContinue': 'ለመቀጠል ይግቡ',
    'chooseLanguage': 'ቋንቋ ይምረጡ',
    'welcomeTitle': 'የኢትዮጵያ የመስመር ላይ ጨረታ ቤት',
    'welcomeBody': 'ስልኮች፣ የቤት መገልገያዎች፣ ተሽከርካሪዎች እና ሌሎችም። በቀጥታ ይጫረቱ፣ በቻፓ በደህንነት ይክፈሉ።',
    'getStarted': 'እንጀምር',
    'browseAsGuest': 'መጀመሪያ ልመልከት',
    'login': 'ግባ',
    'register': 'መለያ ፍጠር',
    'phone': 'ስልክ ቁጥር',
    'phoneHint': '09XX XXX XXX',
    'phoneInvalid': 'ትክክለኛ የኢትዮጵያ ሞባይል ቁጥር ያስገቡ፤ ለምሳሌ 0912345678',
    'password': 'የይለፍ ቃል',
    'firstName': 'ስም',
    'lastName': 'የአባት ስም',
    'emailOptional': 'ኢሜይል (አማራጭ)',
    'createAccount': 'መለያ ፍጠር',
    'haveAccount': 'መለያ አለዎት? ይግቡ',
    'noAccount': 'አዲስ ነዎት? መለያ ይፍጠሩ',
    'forgotPassword': 'የይለፍ ቃል ረሱ?',
    'sendCode': 'ኮድ ላክ',
    'verifyPhone': 'ስልክዎን ያረጋግጡ',
    'codeSentTo': 'ባለ 6 አሃዝ ኮድ ወደ {to} ልከናል',
    'enterCode': 'ባለ 6 አሃዝ ኮድ',
    'verify': 'አረጋግጥ',
    'resendCode': 'ኮድ እንደገና ላክ',
    'resendIn': 'በ{s} ሰከንድ እንደገና ይላኩ',
    'resetPassword': 'የይለፍ ቃል ቀይር',
    'newPassword': 'አዲስ የይለፍ ቃል',
    'passwordRules': 'ቢያንስ 8 ፊደላት፣ ፊደልና ቁጥር ያካተተ',
    'passwordUpdated': 'የይለፍ ቃል ተቀይሯል። በአዲሱ ይግቡ።',
    'verifyLater': 'በኋላ',
    'verifyToBid': 'ለመጫረት ስልክ ቁጥርዎን ያረጋግጡ',
    'navHome': 'መነሻ',
    'navSearch': 'ፈልግ',
    'navMyBids': 'የእኔ ጨረታዎች',
    'navAccount': 'መለያ',
    'searchHint': 'ስልኮች፣ መገልገያዎች፣ መኪናዎች ይፈልጉ…',
    'featured': 'ተመራጭ',
    'liveNow': 'አሁን በቀጥታ',
    'endingSoon': 'ሊያበቁ የቀሩ',
    'upcoming': 'በቅርቡ የሚጀምሩ',
    'recentlyAdded': 'በቅርቡ የተጨመሩ',
    'popularCategories': 'ተወዳጅ ምድቦች',
    'noAuctionsYet': 'እስካሁን ጨረታ የለም። በቅርቡ ይመልከቱ።',
    'statusOpen': 'ሁሉም ክፍት',
    'statusLive': 'በቀጥታ',
    'statusUpcoming': 'የሚመጡ',
    'statusEnded': 'ያበቁ',
    'allCategories': 'ሁሉም ምድቦች',
    'anyCondition': 'ማንኛውም ሁኔታ',
    'sortBy': 'ደርድር',
    'sortEndingSoon': 'ሊያበቁ የቀሩ',
    'sortNewest': 'አዲስ',
    'sortMostBids': 'ብዙ ጨረታ',
    'sortStartingSoon': 'በቅርቡ የሚጀምሩ',
    'noResults': 'የሚዛመድ ጨረታ አልተገኘም',
    'resultsCount': '{n} ጨረታዎች',
    'condition.NEW': 'አዲስ',
    'condition.LIKE_NEW': 'እንደ አዲስ',
    'condition.USED_GOOD': 'ያገለገለ፣ ጥሩ',
    'condition.USED_FAIR': 'ያገለገለ፣ መካከለኛ',
    'condition.FOR_PARTS': 'ለመለዋወጫ',
    'bidOne': '1 ጨረታ',
    'bidMany': '{n} ጨረታዎች',
    'placeBid': 'ተጫረት',
    'noBidsYet': 'እስካሁን ጨረታ የለም። የመጀመሪያው ይሁኑ።',
    'specifications': 'ዝርዝር መግለጫ',
    'description': 'መግለጫ',
    'seller': 'ሻጭ',
    'auctionEnded': 'ይህ ጨረታ አብቅቷል',
    'auctionCancelled': 'ይህ ጨረታ ተሰርዟል',
    'howItWorks': 'እንዴት ይሠራል',
    'howItWorksBody': 'በተፈቀደው ክልል ውስጥ ማንኛውንም መጠን ይምረጡ። ጨረታው ሲያበቃ አንድ ሰው ብቻ ያስገባው ዝቅተኛው መጠን ያሸንፋል፤ አሸናፊው ያንኑ መጠን ብቻ ይከፍላል። እያንዳንዱ ጨረታ አነስተኛ ክፍያ አለው። ጨረታዎች እስከ መጨረሻው ሚስጥር ናቸው።',
    'bidFee': 'የጨረታ ክፍያ',
    'bidFeeEach': 'በአንድ ጨረታ {amount}',
    'bidRange': 'ጨረታ ከ{min} እስከ {max}',
    'itemValue': 'የዕቃው ዋጋ',
    'allowedBids': 'የሚፈቀዱ ጨረታዎች',
    'yourBids': 'የእርስዎ ጨረታዎች',
    'yourBidsOne': '1 ጨረታ አለዎት',
    'yourBidsMany': '{n} ጨረታዎች አለዎት',
    'feeNotPaid': 'ክፍያ አልተፈጸመም',
    'payFee': 'ክፍያ ይፈጽሙ',
    'bidSecretNote': 'የእርስዎ መጠን ሚስጥር ነው። ጨረታው እስኪያበቃ ድረስ ሻጩን ጨምሮ ማንም ጨረታዎችን አያይም።',
    'payFeeAndBid': '{fee} ከፍለው ይጫረቱ',
    'bidAmountHint': 'ለምሳሌ 37.45',
    'results': 'ውጤቶች',
    'winningBid': 'ያሸነፈው ጨረታ',
    'uniqueBid': 'ልዩ',
    'sharedBid': 'የተደገመ',
    'resultsSummary': '{paid} የተከፈለባቸው ጨረታዎች፣ {unique} ልዩ መጠኖች',
    'bidsRevealedAtEnd': 'ሁሉም ጨረታዎች ጨረታው ሲያበቃ ይገለጣሉ',
    'notEnoughBids': 'በቂ ጨረታ አልነበረም። ሁሉም የጨረታ ክፍያዎች ይመለሳሉ።',
    'wonBy': 'አሸናፊ፦ {alias}',
    'yourPrice': 'የእርስዎ ዋጋ',
    'yourPriceHint': 'ያሸነፈው ጨረታ ምንም ይሁን ለዕቃው የሚቀበሉት (10% ኮሚሽን ተቀንሶ)',
    'retailValue': 'የገበያ ዋጋ (አማራጭ)',
    'feesCollected': 'የተሰበሰበ ክፍያ',
    'placeAnotherBid': 'ሌላ ጨረታ ያስገቡ',
    'bidLimitReached': 'ለዚህ ጨረታ የሚፈቀደው ብዛት ላይ ደርሰዋል',
    'youWon': 'አሸንፈዋል!',
    'seeResults': 'ውጤቱን ይመልከቱ',
    'myStatus.BIDDING': 'እየተጫረቱ ነው',
    'purpose.BID_FEE': 'የጨረታ ክፍያ',
    'result.NOT_ENOUGH_BIDS': 'በቂ ጨረታ አልነበረም',
    'error.BID_OUT_OF_RANGE': 'መጠኑ ከተፈቀደው ክልል ውጭ ነው',
    'error.BID_STEP_INVALID': 'በተፈቀደው ደረጃ ያለ መጠን ይጠቀሙ',
    'error.DUPLICATE_BID_AMOUNT': 'ይህን መጠን አስቀድመው አስገብተዋል። ሌላ ይምረጡ።',
    'error.BID_LIMIT_REACHED': 'ለዚህ ጨረታ የሚፈቀደው ብዛት ላይ ደርሰዋል',
    'error.BIDS_SECRET': 'ጨረታዎች ጨረታው ሲያበቃ ይገለጣሉ',
    'noSale': 'ያለ ሽያጭ አብቅቷል',
    'watch': 'ተከታተል',
    'watching': 'እየተከታተሉ ነው',
    'yourListing': 'ይህ የእርስዎ ዕቃ ነው',
    'you': 'እርስዎ',
    'startsSoon': 'ጨረታው በቅርቡ ይከፈታል',
    'yourBid': 'የእርስዎ ጨረታ',
    'minimumIs': 'ዝቅተኛው {amount}',
    'bidPlaced': 'የጨረታ ክፍያ ደርሷል። ጨረታዎ ገብቷል፤ እስከ መጨረሻው ሚስጥር ነው።',
    'amountInvalid': 'መጠኑን በብር ያስገቡ፤ ለምሳሌ 165000',
    'active': 'ንቁ',
    'ended': 'ያበቁ',
    'myStatus.LEADING': 'እየመሩ ነው',
    'myStatus.OUTBID': 'ተበልጠዋል',
    'myStatus.WON': 'አሸንፈዋል',
    'myStatus.LOST': 'አላሸነፉም',
    'myStatus.CANCELLED': 'ተሰርዟል',
    'noBidsMade': 'እስካሁን ምንም አልተጫረቱም',
    'wonAuctions': 'ያሸነፏቸው',
    'payNow': 'አሁን ክፈል',
    'payBy': 'እስከ {when} ይክፈሉ',
    'paid': 'ተከፍሏል',
    'viewReceipt': 'ደረሰኝ እይ',
    'confirmReceived': 'ዕቃውን ተቀብያለሁ',
    'confirmReceivedBody': 'ዕቃውን ሲቀበሉ ብቻ ያረጋግጡ። ከዚያ ሻጩ ይከፈለዋል።',
    'received': 'ተቀብለዋል',
    'amountDue': 'የሚከፈል መጠን',
    'requestRefund': 'ተመላሽ ይጠይቁ',
    'refundReason': 'ምን ችግር ተፈጠረ?',
    'refundRequested': 'የተመላሽ ጥያቄዎ ደርሷል። በቅርቡ እንመለከተዋለን።',
    'result.AWAITING_PAYMENT': 'ክፍያ በመጠበቅ ላይ',
    'result.PAID': 'ተከፍሏል',
    'result.FULFILLED': 'ተጠናቋል',
    'result.DISPUTED': 'ተመላሽ ተጠይቋል',
    'result.PAYMENT_EXPIRED': 'የክፍያ ጊዜ አልፏል',
    'result.CANCELLED': 'ተሰርዟል',
    'watchlist': 'የምከታተላቸው',
    'noWatchlist': 'ለመከታተል በጨረታ ላይ "ተከታተል"ን ይጫኑ',
    'notifications': 'ማሳወቂያዎች',
    'markAllRead': 'ሁሉንም እንደተነበበ ምልክት አድርግ',
    'noNotifications': 'እስካሁን ማሳወቂያ የለም',
    'account': 'መለያ',
    'myBids': 'የእኔ ጨረታዎች',
    'payments': 'ክፍያዎች',
    'settings': 'ቅንብሮች',
    'language': 'ቋንቋ',
    'theme': 'ገጽታ',
    'themeSystem': 'እንደ ስልኩ',
    'themeLight': 'ብሩህ',
    'themeDark': 'ጨለማ',
    'editProfile': 'መገለጫ አስተካክል',
    'phoneVerified': 'ስልክ ተረጋግጧል',
    'phoneNotVerified': 'ስልክ አልተረጋገጠም',
    'verifyNow': 'አሁን አረጋግጥ',
    'becomeSeller': 'በLOW BID ላይ ይሽጡ',
    'sellerDashboard': 'የሻጭ ዳሽቦርድ',
    'guestTitle': 'እንኳን ወደ LOW BID በደህና መጡ',
    'guestBody': 'ለመጫረት፣ ጨረታዎችን ለመከታተል እና ያሸነፉትን ለማየት ይግቡ።',
    'signOutConfirm': 'ከዚህ ስልክ ይውጡ?',
    'profileSaved': 'መገለጫ ተቀምጧል',
    'confirmingPayment': 'ክፍያዎን እያረጋገጥን ነው',
    'confirmingPaymentBody': 'ብዙ ጊዜ ጥቂት ሰከንዶች ይወስዳል። ይህን ገጽ መተው ይችላሉ፤ እናሳውቅዎታለን።',
    'paymentConfirmed': 'ክፍያው ተረጋግጧል',
    'paymentFailed': 'ክፍያው አልተጠናቀቀም',
    'paymentExpired': 'ይህ ክፍያ ጊዜው አልፏል',
    'paymentRefunding': 'ክፍያዎ የደረሰው የክፍያ ጊዜው ካለፈ በኋላ ነው። እየተመለሰ ነው።',
    'tryAgain': 'እንደገና ሞክር',
    'openCheckout': 'የቻፓ ክፍያ ገጽ ክፈት',
    'receipt': 'ደረሰኝ',
    'receiptNo': 'የደረሰኝ ቁጥር',
    'totalPaid': 'ጠቅላላ የተከፈለ',
    'paymentHistory': 'የክፍያ ታሪክ',
    'noPayments': 'እስካሁን ክፍያ የለም',
    'purpose.BID_DEPOSIT': 'የጨረታ ቅድመ ክፍያ',
    'purpose.WINNING_BID': 'ያሸነፉት ጨረታ',
    'paymentStatus.INITIATED': 'በመጀመር ላይ',
    'paymentStatus.PENDING': 'በመጠባበቅ ላይ',
    'paymentStatus.PAID': 'ተከፍሏል',
    'paymentStatus.FAILED': 'አልተሳካም',
    'paymentStatus.EXPIRED': 'ጊዜው አልፏል',
    'paymentStatus.REFUNDED': 'ተመልሷል',
    'paymentStatus.PARTIALLY_REFUNDED': 'በከፊል ተመልሷል',
    'paidWith': 'የተከፈለው በ',
    'reference': 'መለያ ቁጥር',
    'sellerApply': 'ሻጭ ይሁኑ',
    'sellerApplyBody': 'ስለ ንግድዎ ይንገሩን። መታወቂያዎን ካረጋገጥን በኋላ ዕቃዎችን ማቅረብ ይችላሉ።',
    'businessName': 'የንግድ ወይም የሚታይ ስም',
    'businessType': 'የሚሸጡት እንደ',
    'individual': 'ግለሰብ',
    'company': 'ድርጅት',
    'tin': 'የግብር ከፋይ መለያ ቁጥር (10 አሃዝ)',
    'city': 'ከተማ',
    'address': 'አድራሻ',
    'bio': 'ስለ እርስዎ',
    'payoutMethod': 'ክፍያ የሚቀበሉበት',
    'bankTransfer': 'የባንክ ሂሳብ',
    'telebirr': 'ቴሌብር',
    'bank': 'ባንክ',
    'accountName': 'የሂሳብ ባለቤት ስም',
    'accountNumber': 'የሂሳብ ቁጥር',
    'telebirrNumber': 'የቴሌብር ስልክ ቁጥር',
    'submitApplication': 'ማመልከቻ አስገባ',
    'sellerStatus.PENDING': 'ማመልከቻዎ በግምገማ ላይ ነው',
    'sellerStatus.APPROVED': 'የጸደቀ ሻጭ',
    'sellerStatus.REJECTED': 'ማመልከቻዎ አልጸደቀም',
    'sellerStatus.SUSPENDED': 'የሻጭ መለያዎ ታግዷል',
    'sellerStatusBody.PENDING': 'ሰነዶችዎን በቅርቡ እንገመግማለን።',
    'sellerStatusBody.APPROVED': 'ዕቃዎችን ማቅረብና ጨረታ መወሰን ይችላሉ።',
    'sellerStatusBody.REJECTED': 'መረጃዎን ወይም ሰነዶችዎን አስተካክለው እንደገና ያመልክቱ።',
    'sellerStatusBody.SUSPENDED': 'የLOW BID ድጋፍ ሰጪን ያግኙ።',
    'missingDocuments': 'ገና የሚያስፈልጉ',
    'missing.IDENTITY_DOCUMENT': 'መታወቂያ፦ ፋይዳ፣ የቀበሌ፣ ፓስፖርት ወይም መንጃ ፈቃድ',
    'missing.TRADE_LICENSE': 'የንግድ ፈቃድ',
    'missing.TIN_NUMBER': 'የግብር ከፋይ መለያ ቁጥር',
    'documents': 'የማረጋገጫ ሰነዶች',
    'uploadDocument': 'ሰነድ ጫን',
    'documentType': 'የሰነድ ዓይነት',
    'doc.FAYDA_ID': 'ፋይዳ መታወቂያ',
    'doc.KEBELE_ID': 'የቀበሌ መታወቂያ',
    'doc.PASSPORT': 'ፓስፖርት',
    'doc.DRIVING_LICENSE': 'መንጃ ፈቃድ',
    'doc.TRADE_LICENSE': 'የንግድ ፈቃድ',
    'doc.TIN_CERTIFICATE': 'የግብር ከፋይ ምስክር ወረቀት',
    'docStatus.PENDING': 'በግምገማ ላይ',
    'docStatus.APPROVED': 'ጸድቋል',
    'docStatus.REJECTED': 'ውድቅ ተደርጓል',
    'myListings': 'የእኔ ዕቃዎች',
    'newListing': 'አዲስ ዕቃ',
    'editListing': 'ዕቃ አስተካክል',
    'title': 'ርዕስ',
    'category': 'ምድብ',
    'location': 'አካባቢ',
    'highlights': 'በካርዱ ላይ የሚታዩ',
    'highlightsHint': 'በጨረታ ካርዱ ላይ የሚታዩ እስከ 3 አጫጭር መግለጫዎች፤ ለምሳሌ 256GB። ዋጋ አይጻፍም።',
    'specGroups': 'ዝርዝር መግለጫ',
    'addGroup': 'ክፍል ጨምር',
    'addRow': 'መስመር ጨምር',
    'groupName': 'ክፍል፣ ለምሳሌ ስክሪን',
    'label': 'መለያ',
    'value': 'ዋጋ/መረጃ',
    'photos': 'ፎቶዎች',
    'addPhotos': 'ፎቶ ጨምር',
    'photosAfterSave': 'መጀመሪያ ረቂቁን ያስቀምጡ፣ ከዚያ ፎቶ ይጨምሩ።',
    'saveDraft': 'አስቀምጥ',
    'submitForReview': 'ለግምገማ አስገባ',
    'listingStatus.DRAFT': 'ረቂቅ',
    'listingStatus.PENDING_REVIEW': 'በግምገማ ላይ',
    'listingStatus.APPROVED': 'ጸድቋል',
    'listingStatus.REJECTED': 'ማስተካከያ ያስፈልጋል',
    'listingStatus.ARCHIVED': 'ተቀምጧል',
    'scheduleAuction': 'ጨረታ ይወስኑ',
    'startsAt': 'የሚጀምርበት',
    'duration': 'የሚቆይበት ጊዜ',
    'createAuction': 'ጨረታውን ለማጽደቅ አስገባ',
    'auctionSubmitted': 'ጨረታው ገብቷል። ከመጀመሩ በፊት እናጸድቀዋለን።',
    'myAuctions': 'የእኔ ጨረታዎች',
    'earnings': 'ገቢ',
    'grossSales': 'ሽያጭ',
    'commission': 'የLOW BID ክፍያ (10%)',
    'netEarnings': 'የእርስዎ ገቢ',
    'paidOut': 'የተከፈለዎት',
    'pendingPayout': 'የሚመጣ',
    'onHold': 'የተያዘ',
    'payouts': 'ክፍያዎች ለእርስዎ',
    'auctionStatus.PENDING_APPROVAL': 'ማጽደቅን በመጠባበቅ ላይ',
    'auctionStatus.SCHEDULED': 'ተይዟል',
    'auctionStatus.LIVE': 'በቀጥታ',
    'auctionStatus.CLOSED': 'አብቅቷል',
    'auctionStatus.CANCELLED': 'ተሰርዟል',
    'rejectedBecause': 'ምክንያት፦ {reason}',
    'hours': '{n} ሰዓት',
    'days': '{n} ቀናት',
    'error.NETWORK_ERROR': 'የኢንተርኔት ግንኙነት የለም። ግንኙነትዎን ፈትሸው እንደገና ይሞክሩ።',
    'error.TIMEOUT': 'ግንኙነቱ ቀርፋፋ ነው። እንደገና ይሞክሩ።',
    'error.AUTH_INVALID_CREDENTIALS': 'ስልክ ቁጥር ወይም የይለፍ ቃል ትክክል አይደለም',
    'error.PHONE_TAKEN': 'በዚህ ስልክ ቁጥር መለያ አስቀድሞ አለ',
    'error.OTP_INVALID': 'ኮዱ ትክክል አይደለም',
    'error.OTP_EXPIRED': 'ኮዱ ጊዜው አልፏል። አዲስ ይጠይቁ።',
    'error.OTP_COOLDOWN': 'ሌላ ኮድ ከመጠየቅዎ በፊት ትንሽ ይጠብቁ',
    'error.ACCOUNT_SUSPENDED': 'መለያዎ ታግዷል። ድጋፍ ሰጪን ያግኙ።',
    'error.PHONE_NOT_VERIFIED': 'መጀመሪያ ስልክ ቁጥርዎን ያረጋግጡ',
    'error.AUCTION_ENDED': 'ይህ ጨረታ አብቅቷል',
    'error.AUCTION_NOT_STARTED': 'ጨረታው ገና አልተጀመረም',
    'error.SELLER_CANNOT_BID': 'በራስዎ ዕቃ ላይ መጫረት አይችሉም',
    'error.ALREADY_LEADING': 'ከፍተኛው ጨረታ አስቀድሞ የእርስዎ ነው',
    'error.DEPOSIT_REQUIRED': 'ለመጫረት ተመላሽ የሚሆን ቅድመ ክፍያ ይክፈሉ',
    'error.BID_TOO_LOW': 'ሌላ ሰው ከፍ አድርጎ ተጫርቷል። ጨረታዎን ከፍ ያድርጉ።',
    'error.BID_TOO_HIGH': 'መጠኑ ከሚያስፈልገው በጣም ይበልጣል። ያረጋግጡ።',
    'error.BIDDING_BLOCKED': 'ያልተከፈሉ ድሎች ስላሉ መጫረት ታግዷል። ድጋፍ ሰጪን ያግኙ።',
    'error.RATE_LIMITED': 'በጣም ፈጥነዋል። ትንሽ ቆይተው ይሞክሩ።',
    'error.PAYMENT_INIT_FAILED': 'ክፍያው መጀመር አልቻለም። እንደገና ይሞክሩ።',
    'error.PAYMENT_PROVIDER_UNAVAILABLE': 'ክፍያ አሁን አይሰራም። ትንሽ ቆይተው ይሞክሩ።',
    'error.PAYMENT_DEADLINE_PASSED': 'የክፍያ ጊዜው አልፏል',
    'error.ALREADY_PAID': 'ለዚህ ዕቃ አስቀድመው ከፍለዋል',
    'error.DEPOSIT_ALREADY_PAID': 'ቅድመ ክፍያዎ አስቀድሞ ተከፍሏል',
    'error.PRODUCT_LOCKED': 'ይህ ዕቃ በሂደት ላይ ያለ ጨረታ ስላለው መቀየር አይቻልም',
    'error.IMAGE_TOO_SMALL': 'ፎቶዎች በአጭሩ ጎን ቢያንስ 400 ፒክሰል መሆን አለባቸው',
    'error.IMAGE_TYPE_NOT_ALLOWED': 'JPEG ወይም PNG ፎቶ ይጠቀሙ',
    'error.FILE_TOO_LARGE': 'ፋይሉ በጣም ትልቅ ነው (ቢበዛ 8 MB)',
  };
}
