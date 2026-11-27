const displayNameKey = 'lifecase_display_name';

export function cleanDisplayName(value) {
  if (typeof value !== 'string') return '';
  return Array.from(value.replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/\s+/gu, ' ').trim()).slice(0, 48).join('');
}

export function profileName(user) {
  const metadata = user?.user_metadata ?? {};
  if (typeof metadata[displayNameKey] === 'string') return cleanDisplayName(metadata[displayNameKey]);
  return cleanDisplayName(metadata.first_name) || cleanDisplayName(metadata.given_name) ||
    (cleanDisplayName(metadata.full_name) || cleanDisplayName(metadata.name)).split(' ')[0];
}

export const profileUpdate = name => ({ [displayNameKey]: cleanDisplayName(name) });

export function profileInitials(name) {
  return name.split(' ').filter(Boolean).slice(0, 2).map(word => Array.from(word)[0]).join('').toLocaleUpperCase('de-CH');
}
