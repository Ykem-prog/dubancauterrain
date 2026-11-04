# Du banc au terrain

Site public de la prépa foot d'hiver : compte à rebours, tableau des 91 jours, pronostic, vote du public, journal avec photos, et toutes les séances détaillées.

- Les visiteurs voient tout en lecture seule et peuvent voter « Il va y arriver ? » (un vote par navigateur, modifiable).
- Toi seul, connecté avec ton mot de passe, coches les séances, écris les bilans, envoies des photos et changes les réglages.
- L'espace admin est invisible : aucun lien sur le site, et la connexion ne fonctionne qu'avec ton **lien secret**. Sans lui, le serveur répond comme si l'admin n'existait pas.

## Structure

```
public/            le site (HTML, CSS, JS, sans framework)
  index.html
  style.css
  plan.js          le programme des 13 semaines
  app.js           l'affichage, le mode admin, les votes
netlify/
  functions/       l'API
    state.mjs      GET/PUT /api/state   données du site
    auth.mjs       /api/login, /api/logout, /api/me
    vote.mjs       GET/POST /api/vote   vote du public
    media.mjs      POST /api/media, GET /media/:id   photos et vidéos
  lib/shared.mjs   stockage, session admin, validation
test/              tests de l'API (npm test)
netlify.toml       configuration et en-têtes de sécurité
```

Les données sont stockées dans **Netlify Blobs**, inclus dans Netlify : aucune base de données externe à créer.

## Déployer (une seule fois)

1. **Mettre le code sur GitHub**
   Crée un dépôt privé `dubancauterrain` et pousse ce dossier :
   ```bash
   git init
   git add .
   git commit -m "Du banc au terrain"
   git branch -M main
   git remote add origin git@github.com:TON-COMPTE/dubancauterrain.git
   git push -u origin main
   ```

2. **Créer le site sur Netlify**
   Netlify → *Add new site* → *Import an existing project* → GitHub → choisis le dépôt.
   Laisse les réglages proposés : ils viennent de `netlify.toml` (dossier publié : `public`).

3. **Ajouter les deux variables secrètes, avant le premier déploiement**
   *Site configuration* → *Environment variables* :

   | Nom | Valeur |
   |---|---|
   | `ADMIN_PASSWORD` | ton mot de passe admin, **au moins 10 caractères**, que tu n'utilises nulle part ailleurs |
   | `SESSION_SECRET` | une longue chaîne aléatoire d'au moins 32 caractères |
   | `ADMIN_LOGIN_KEY` | la clé de ton lien de connexion secret, au moins 16 caractères (lettres, chiffres, `-` ou `_`) |

   Pour générer `SESSION_SECRET` et `ADMIN_LOGIN_KEY` (lance la commande deux fois, une valeur différente pour chacune) :
   ```bash
   node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
   ```
   Sans `ADMIN_LOGIN_KEY`, la connexion admin reste désactivée.
   Puis relance le déploiement : *Deploys* → *Trigger deploy*.

4. **Brancher ton domaine**
   *Domain management* → *Add a domain* → `dubancauterrain.ch`.
   Netlify t'indique les enregistrements DNS à créer chez ton registraire (ou te propose de lui confier le DNS).
   Supprime l'ancienne redirection web vers claude.ai quand le domaine pointe vers Netlify.
   Le certificat HTTPS est créé automatiquement. Fais pareil pour `dubancauterrain.com` en domaine secondaire.

5. **Te connecter et reprendre tes données**
   Ouvre ton lien secret : `https://dubancauterrain.ch/#entree=TA_CLE` (remplace `TA_CLE` par la valeur de `ADMIN_LOGIN_KEY`), puis entre ton mot de passe.
   Enregistre ce lien dans tes favoris ou ton gestionnaire de mots de passe, et ne le partage avec personne. La clé disparaît de la barre d'adresse dès que la page s'ouvre.
   Dans *Réglages du site* → *Reprendre les données de l'ancien site*, colle les données de l'ancien site, puis *Importer et publier*.
   Les coches, le journal et les réglages sont repris. Les photos envoyées sur l'ancien site, elles, sont à renvoyer.

## Utilisation au quotidien

- Ouvre le site connecté : la barre orange « Mode édition » apparaît.
- Coche la séance du jour : elle est publiée en 1 à 2 secondes.
- Le dimanche, écris le bilan : texte, photos (réduites automatiquement), poids si tu veux, lien TikTok.
- *Voir comme un visiteur* te montre ce que voit le public. *Déconnexion* ferme ta session sur cet appareil.
- La session dure 30 jours par appareil. Ensuite, rouvre ton lien secret.
- Après 8 mots de passe ratés en 15 minutes, la connexion est bloquée 15 minutes.
- Si ton lien secret fuite, change `ADMIN_LOGIN_KEY` dans Netlify et redéploie : l'ancien lien ne marche plus. Pour déconnecter tous tes appareils d'un coup, change aussi `SESSION_SECRET`.

Les visiteurs voient les changements avec au maximum 20 secondes de décalage (cache du CDN).

## Limites à connaître

- **Fichiers** : 4,5 Mo maximum par photo ou vidéo (limite des fonctions Netlify). Pour les vidéos plus longues, mets le lien TikTok.
- **Votes** : un vote par navigateur, grâce à un cookie. Quelqu'un de très motivé peut voter plusieurs fois en changeant de navigateur. C'est suffisant pour un sondage de compte TikTok, pas pour un vote officiel. Tu peux fermer le vote dans les réglages.
- **Offre gratuite Netlify** : largement suffisante pour démarrer. Surveille l'onglet *Usage* si une vidéo fait le buzz.

## Développer en local

```bash
npm install
npm test                         # tests de l'API
npm install -g netlify-cli
netlify link                     # relie le dossier à ton site Netlify
netlify dev                      # site + fonctions sur http://localhost:8888
```

En local, crée un fichier `.env` (jamais commité) avec `ADMIN_PASSWORD` et `SESSION_SECRET`.
