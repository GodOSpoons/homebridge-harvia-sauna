export class HarviaAuthError extends Error {}

export class HarviaConnectionError extends Error {}

// Thrown on HTTP 402 from harvia.io: the account is on the free MyHarvia
// Core tier, which only allows monitoring. Remote control (what triggers
// this) requires the paid MyHarvia Control license.
export class HarviaEntitlementError extends Error {}
