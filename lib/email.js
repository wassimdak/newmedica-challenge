// Notification par email via l'API HTTP de Resend (pas de SMTP à configurer). Sans RESEND_API_KEY,
// l'envoi est simplement ignoré (avec un avertissement en log) plutôt que de faire échouer l'action
// de la préparatrice qui a déclenché la notification.
//
// Destinataire par défaut : dakhwass@gmail.com, pas wassim.dakhlaoui@newmedica.tn — tant que le
// domaine newmedica.tn n'est pas vérifié chez Resend, le compte gratuit ne peut envoyer qu'à
// l'adresse du titulaire du compte Resend. Une fois le domaine vérifié, changer
// RECOMPENSE_NOTIFY_EMAIL (ou cette valeur par défaut) vers l'adresse newmedica.tn.
const NOTIFY_EMAIL_RECOMPENSE = process.env.RECOMPENSE_NOTIFY_EMAIL || 'dakhwass@gmail.com';

async function envoyerEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn(`RESEND_API_KEY non défini : email "${subject}" à ${to} non envoyé.`);
    return;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'NewMedica Challenge <onboarding@resend.dev>', to: [to], subject, html }),
    });
    if (!res.ok) {
      console.error(`Échec envoi email "${subject}" :`, res.status, await res.text());
    }
  } catch (err) {
    console.error(`Erreur réseau envoi email "${subject}" :`, err);
  }
}

async function notifierEchangeRecompense({ preparativePrenom, preparatriceNom, pharmacieNom, recompenseNom, coutPoints }) {
  await envoyerEmail({
    to: NOTIFY_EMAIL_RECOMPENSE,
    subject: `🎁 ${preparativePrenom} ${preparatriceNom} a échangé une récompense`,
    html: `
      <p><strong>${preparativePrenom} ${preparatriceNom}</strong> (${pharmacieNom}) vient d'échanger :</p>
      <p style="font-size: 18px;"><strong>${recompenseNom}</strong> — ${coutPoints} points</p>
      <p><a href="https://newmedica-challenge.onrender.com/admin/recompenses">Voir la demande dans le back-office →</a></p>
    `,
  });
}

module.exports = { envoyerEmail, notifierEchangeRecompense };
