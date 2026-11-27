// iOS Home Screen web apps have their own storage and do not share it with Safari.
export function persistsSession(hostname, standalone) {
  return hostname !== 'joelism.github.io' || standalone === true;
}
