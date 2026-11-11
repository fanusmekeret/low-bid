// Bilingual notification texts. Amharic wording: have a native speaker review before launch.
// Each template receives a params object and returns { titleEn, titleAm, bodyEn, bodyAm }.

const clip = (s, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export const TEMPLATES = {
  BID_CONFIRMED: ({ title, amount }) => ({
    titleEn: 'Bid placed',
    titleAm: 'ጨረታዎ ገብቷል',
    bodyEn: `Your bid of ${amount} on "${clip(title)}" is in. Bids stay secret until the auction ends.`,
    bodyAm: `በ"${clip(title)}" ላይ ያስገቡት ${amount} ጨረታ ተመዝግቧል። ጨረታዎች እስከ መጨረሻው ሚስጥር ናቸው።`,
  }),
  AUCTION_ENDING_SOON: ({ title, minutes }) => ({
    titleEn: 'Auction ending soon',
    titleAm: 'ጨረታው ሊያበቃ ነው',
    bodyEn: `"${clip(title)}" ends in about ${minutes} minutes.`,
    bodyAm: `"${clip(title)}" በ${minutes} ደቂቃ ገደማ ያበቃል።`,
  }),
  AUCTION_WON: ({ title, amount, hours }) => ({
    titleEn: 'You won!',
    titleAm: 'አሸንፈዋል!',
    bodyEn: `You won "${clip(title)}" for ${amount}. Pay within ${hours} hours to complete the purchase.`,
    bodyAm: `"${clip(title)}"ን በ${amount} አሸንፈዋል። ግዢውን ለማጠናቀቅ በ${hours} ሰዓት ውስጥ ይክፈሉ።`,
  }),
  AUCTION_LOST: ({ title, noSale, feesRefunded }) => ({
    titleEn: 'Auction ended',
    titleAm: 'ጨረታው አብቅቷል',
    bodyEn: feesRefunded
      ? `"${clip(title)}" did not get enough bids, so it ended without a sale. Your bid fees will be refunded.`
      : noSale ? `"${clip(title)}" ended without a sale.` : `"${clip(title)}" has ended and another bidder won. See all bids in the results.`,
    bodyAm: feesRefunded
      ? `"${clip(title)}" በቂ ጨረታ ስላላገኘ ያለ ሽያጭ አብቅቷል። የጨረታ ክፍያዎ ይመለስልዎታል።`
      : noSale ? `"${clip(title)}" ያለ ሽያጭ አብቅቷል።` : `"${clip(title)}" አብቅቷል፤ ሌላ ተጫራች አሸንፏል። ሁሉንም ጨረታዎች በውጤቱ ይመልከቱ።`,
  }),
  AUCTION_CANCELLED: ({ title, reason }) => ({
    titleEn: 'Auction cancelled',
    titleAm: 'ጨረታው ተሰርዟል',
    bodyEn: `"${clip(title)}" was cancelled: ${reason}`,
    bodyAm: `"${clip(title)}" ተሰርዟል፦ ${reason}`,
  }),
  PAYMENT_SUCCESS: ({ title, amount, receiptNo }) => ({
    titleEn: 'Payment confirmed',
    titleAm: 'ክፍያዎ ተረጋግጧል',
    bodyEn: `We received ${amount} for "${clip(title)}". Receipt ${receiptNo}.`,
    bodyAm: `ለ"${clip(title)}" ${amount} ተቀብለናል። ደረሰኝ ${receiptNo}።`,
  }),
  PAYMENT_FAILED: ({ title }) => ({
    titleEn: 'Payment not completed',
    titleAm: 'ክፍያው አልተጠናቀቀም',
    bodyEn: `Your payment for "${clip(title)}" did not go through. You can try again.`,
    bodyAm: `ለ"${clip(title)}" ያደረጉት ክፍያ አልተሳካም። እንደገና መሞከር ይችላሉ።`,
  }),
  PAYMENT_REMINDER: ({ title, hours }) => ({
    titleEn: 'Payment due soon',
    titleAm: 'የክፍያ ጊዜ እየደረሰ ነው',
    bodyEn: `Pay for "${clip(title)}" within ${hours} hours or the item goes to another bidder.`,
    bodyAm: `ለ"${clip(title)}" በ${hours} ሰዓት ውስጥ ይክፈሉ፤ ካልሆነ ዕቃው ለሌላ ተጫራች ይሰጣል።`,
  }),
  PAYMENT_EXPIRED: ({ title }) => ({
    titleEn: 'Payment time ended',
    titleAm: 'የክፍያ ጊዜ አልፏል',
    bodyEn: `You did not pay for "${clip(title)}" in time, so the win was cancelled.`,
    bodyAm: `ለ"${clip(title)}" በጊዜው ስላልከፈሉ አሸናፊነትዎ ተሰርዟል።`,
  }),
  SECOND_CHANCE_OFFER: ({ title, amount, hours }) => ({
    titleEn: 'Second chance: it can be yours',
    titleAm: 'ሁለተኛ ዕድል',
    bodyEn: `The winner of "${clip(title)}" did not pay. Buy it for your bid of ${amount} by paying within ${hours} hours.`,
    bodyAm: `የ"${clip(title)}" አሸናፊ አልከፈለም። በጫረቱት ${amount} ለመግዛት በ${hours} ሰዓት ውስጥ ይክፈሉ።`,
  }),
  ITEM_DELIVERED: ({ title, days }) => ({
    titleEn: 'Item delivered',
    titleAm: 'ዕቃው ደርሷል',
    bodyEn: `LOW BID delivered "${clip(title)}". If something is wrong, request a refund in the app within ${days} days.`,
    bodyAm: `LOW BID "${clip(title)}"ን አድርሷል። ችግር ካለ በ${days} ቀናት ውስጥ በመተግበሪያው ተመላሽ ይጠይቁ።`,
  }),
  REFUND_ISSUED: ({ title, amount }) => ({
    titleEn: 'Refund sent',
    titleAm: 'ተመላሽ ተልኳል',
    bodyEn: `${amount} for "${clip(title)}" has been refunded to your payment method.`,
    bodyAm: `ለ"${clip(title)}" ${amount} ወደ ከፈሉበት ተመልሷል።`,
  }),
};
