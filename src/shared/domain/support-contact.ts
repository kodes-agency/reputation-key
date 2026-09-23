// The one human channel the product may point a reader at.
//
// A leaf module on purpose: notification copy renders in the browser bundle as
// well as in the worker, so the address cannot live behind anything heavier,
// and it is a published product fact rather than configuration — a deployment
// that changed it would also have to change the copy that names it.
//
// It is monitored by the owner. Anything that tells a reader to "contact
// support" must name it, and mail a reader may need to answer must set it as
// the reply-to; the From address stays the sending identity (EMAIL_FROM).
export const SUPPORT_EMAIL = 'denev@kodes.agency'
