function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.btn-echanger');
  if (!btn || btn.disabled) return;

  const id = btn.dataset.id;
  const nom = btn.dataset.nom;
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = '...';

  try {
    const res = await fetch(`/recompenses/${id}/echanger`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || "Erreur lors de l'échange");
      btn.disabled = false;
      btn.textContent = original;
      return;
    }
    showToast(`Demande envoyée pour « ${nom} »`);
    const soldeEl = document.getElementById('solde-points');
    if (soldeEl) soldeEl.textContent = data.nouveauSolde;
    setTimeout(() => window.location.reload(), 1200);
  } catch (err) {
    showToast('Erreur réseau');
    btn.disabled = false;
    btn.textContent = original;
  }
});
