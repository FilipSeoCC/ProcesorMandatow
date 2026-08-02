import "server-only";

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]!,
  );

const roleLabel: Record<string, string> = {
  admin: "Administrator",
  boss: "Boss (kierownik/szef)",
  user: "User (pracownik)",
};

export function buildRegistrationReceivedEmail(name: string) {
  const greeting = name ? `Dzień dobry, ${escapeHtml(name)}` : "Dzień dobry";
  return {
    subject: "Dziękujemy za rejestrację w FlotaFlow",
    text: `${greeting},\n\nDziękujemy za rejestrację w FlotaFlow. Twoje konto zostało utworzone i czeka teraz na zatwierdzenie przez administratora — dopiero po przyznaniu roli będziesz mógł/mogła się zalogować.\n\nGdy tylko otrzymasz dostęp, wyślemy kolejnego e-maila z potwierdzeniem.\n\nZ poważaniem,\nFlotaFlow`,
    html: `<p>${greeting},</p><p>Dziękujemy za rejestrację w FlotaFlow. Twoje konto zostało utworzone i czeka teraz na zatwierdzenie przez administratora — dopiero po przyznaniu roli będziesz mógł/mogła się zalogować.</p><p>Gdy tylko otrzymasz dostęp, wyślemy kolejnego e-maila z potwierdzeniem.</p><p>Z poważaniem,<br>FlotaFlow</p>`,
  };
}

export function buildRoleGrantedEmail(name: string, role: string, appUrl: string) {
  const greeting = name ? `Dzień dobry, ${escapeHtml(name)}` : "Dzień dobry";
  const label = roleLabel[role] ?? role;
  return {
    subject: "Twoje konto FlotaFlow zostało zatwierdzone",
    text: `${greeting},\n\nPrzyznano Ci rolę: ${label}. Możesz się teraz zalogować i korzystać z FlotaFlow: ${appUrl}\n\nZ poważaniem,\nFlotaFlow`,
    html: `<p>${greeting},</p><p>Przyznano Ci rolę: <strong>${escapeHtml(label)}</strong>. Możesz się teraz zalogować i korzystać z FlotaFlow.</p><p><a href="${escapeHtml(appUrl)}">${escapeHtml(appUrl)}</a></p><p>Z poważaniem,<br>FlotaFlow</p>`,
  };
}
