document.addEventListener('click', async (e) => {
  const toggleStatut = e.target.closest('.btn-toggle-statut');
  if (toggleStatut) {
    const id = toggleStatut.dataset.id;
    const res = await fetch(`/admin/preparatrices/${id}/toggle`, { method: 'POST' });
    if (res.ok) window.location.reload();
    return;
  }

  const toggleChallenge = e.target.closest('.btn-toggle-challenge');
  if (toggleChallenge) {
    const id = toggleChallenge.dataset.id;
    const res = await fetch(`/admin/challenges/${id}/toggle`, { method: 'POST' });
    if (res.ok) window.location.reload();
    return;
  }

  const toggleProduit = e.target.closest('.btn-toggle-produit');
  if (toggleProduit) {
    const id = toggleProduit.dataset.id;
    const res = await fetch(`/admin/produits/${id}/toggle`, { method: 'POST' });
    if (res.ok) window.location.reload();
    return;
  }
});
