/* ==========================================================================
   TaskLink - shared browser code (loaded on every page)
   ========================================================================== */

/* ---- Talking to the Flask backend ---- */
async function api(url, method = "GET", body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error("Cannot reach the server. Is TaskLink running?");
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.blocked) location.href = "login.html?blocked=1";
  else if (res.status === 401 && document.body.hasAttribute("data-nav")) location.href = "login.html";
  if (!res.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

/* Send a file (FormData). Returns the JSON answer or throws an Error with a readable message. */
async function postForm(url, formBody) {
  let res;
  try { res = await fetch(url, { method: "POST", body: formBody }); }
  catch (e) { throw new Error("Cannot reach the server. Is TaskLink running?"); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) location.href = data.blocked ? "login.html?blocked=1" : "login.html";
  if (!res.ok) throw new Error(data.error || "Upload failed");
  return data;
}

/* ---- Small helpers ---- */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const formData = (form) => Object.fromEntries(new FormData(form));

const AVATAR_COLORS = ["#2563eb", "#16a34a", "#c2610c", "#7c3aed", "#0f766e"];
const initials = (n) => (n || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
const colorFor = (n) => AVATAR_COLORS[[...(n || "")].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length];
/* 15000 -> "15 000" */
const money = (n) => String(n ?? "").replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const photoUrl = (name) => "/uploads/" + encodeURIComponent(name);

/* Round avatar: the profile picture if there is one, otherwise coloured initials. */
function renderAvatar(el, user) {
  el.textContent = "";
  el.style.background = colorFor(user.full_name);
  const showInitials = () => { el.textContent = initials(user.full_name); };
  if (user.profile_photo) {
    const img = document.createElement("img");
    img.alt = (user.full_name || "") + " - profile picture";
    img.onerror = () => { img.remove(); showInitials(); };
    img.src = photoUrl(user.profile_photo);
    el.appendChild(img);
  } else showInitials();
}

/* Same avatar as an HTML string, for cards. */
const avatarHtml = (name, photo, cls = "avatar avatar-sm") =>
  `<div class="${cls}" style="background:${colorFor(name)}" aria-hidden="true">${
    photo ? `<img src="${photoUrl(photo)}" alt="" onerror="this.remove()">` : esc(initials(name))}</div>`;

/* Stars and review cards (provider page and your own profile) */
const starsHtml = (n) => `<span class="stars" role="img" aria-label="${esc(n)}/5">${"★".repeat(n)}<span class="off">${"★".repeat(5 - n)}</span></span>`;
const reviewHtml = (r) => `<div class="card review">
  <div class="card-head">${avatarHtml(r.reviewer, r.reviewer_photo)}
    <div class="who"><b>${esc(r.reviewer)}</b> ${r.verified ? `<span class="badge open">Verified mission</span>` : ""}
      <div class="meta">${starsHtml(r.rating)}${r.created ? ` · ${esc(fmtDate(r.created))}` : ""}</div></div></div>
  ${r.comment ? `<p>${esc(r.comment)}</p>` : ""}</div>`;

/* The server stores dates in UTC: show them in the visitor's local time. */
function fmtDate(s) {
  const d = new Date(String(s || "").replace(" ", "T") + "Z");
  return isNaN(d) ? String(s || "") : d.toLocaleString(lang === "fr" ? "fr-FR" : "en-GB", { dateStyle: "medium", timeStyle: "short" });
}

/* ---- Notifications: the sentence is built here so it follows the FR / EN switch ---- */
function noteText(n) {
  const fr = lang === "fr", name = n.ref_name || "";
  return ({
    report_accepted: fr ? `Signalement accepté : le compte de ${name} a été bloqué.` : `Report accepted: ${name}'s account has been blocked.`,
    report_rejected: fr ? `Signalement examiné : aucune action contre ${name}.` : `Report reviewed: no action was taken against ${name}.`,
    report_new: fr ? `Nouveau signalement contre ${name}.` : `New report against ${name}.`,
  })[n.kind] || String(n.kind || "");
}
function noteExtra(n) {
  if (!n.note) return "";
  const fr = lang === "fr";
  const label = n.kind === "report_new" ? (fr ? "Motif : " : "Reason: ") : (fr ? "Message de l'administrateur : " : "Admin message: ");
  return label + n.note;
}
function toast(text, href) {
  const el = document.createElement("a");
  el.className = "toast"; el.href = href || "notifications.html"; el.textContent = "🔔 " + text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 9000);
}
const fileSize = (b) => b < 1024 * 1024 ? Math.max(1, Math.round(b / 1024)) + " KB" : (b / 1048576).toFixed(1) + " MB";

/* ---- Page frame: bottom menu, top space for the language button ---- */
const PAGE = location.pathname.split("/").pop().replace(".html", "") || "index";
document.body.classList.add(document.querySelector(".welcome") ? "is-welcome" : "has-top");

if (document.body.hasAttribute("data-nav")) {
  const tab = { home: "home", services: "services", missions: "services", provider: "services", message: "message", route: "message", place: "profile", profile: "profile", admin: "admin" }[PAGE];
  const link = (href, key, label) => `<a href="${href}"${tab === key ? ' class="active" aria-current="page"' : ""}>${label}</a>`;
  document.body.insertAdjacentHTML("beforeend", `<nav aria-label="Main">
    ${link("home.html", "home", "Home")}${link("services.html", "services", "Explore")}
    ${link("message.html", "message", "Messages")}${link("profile.html", "profile", "Profile")}</nav>`);

  /* Red dot with the number of unread chat messages */
  const msgLink = document.querySelector('body > nav a[href="message.html"]');
  const refreshUnread = async () => {
    try {
      const { count } = await fetch("/api/chat/unread").then((r) => r.json());
      let b = msgLink.querySelector(".nav-badge");
      if (count > 0) {
        if (!b) { b = document.createElement("span"); b.className = "nav-badge"; msgLink.appendChild(b); }
        b.textContent = count > 9 ? "9+" : count;
      } else if (b) b.remove();
    } catch (e) {}
  };
  window.refreshUnread = refreshUnread;
  refreshUnread();
  setInterval(() => { if (!document.hidden) refreshUnread(); }, 15000);

  /* Bell: unread notifications (e.g. the administrator's decision on your report), pop-up for new ones.
     Administrators also get an "Admin" tab. */
  document.body.insertAdjacentHTML("beforeend", `<a id="bell" href="notifications.html" aria-label="Notifications">🔔</a>`);
  const bell = document.getElementById("bell");
  let seenId = null;
  const refreshNotes = async () => {
    try {
      const r = await fetch("/api/notifications/unread").then((x) => x.json());
      if (r.count === undefined) return;
      let b = bell.querySelector(".nav-badge");
      if (r.count > 0) {
        if (!b) { b = document.createElement("span"); b.className = "nav-badge"; bell.appendChild(b); }
        b.textContent = r.count > 9 ? "9+" : r.count;
      } else if (b) b.remove();
      if (r.is_admin && !document.querySelector('body > nav a[href="admin.html"]')) {
        document.querySelector("body > nav").insertAdjacentHTML("beforeend", link("admin.html", "admin", "Admin"));
      }
      if (r.latest) {
        if (seenId !== null && r.latest.id > seenId) toast(noteText(r.latest), r.latest.link);
        seenId = Math.max(seenId || 0, r.latest.id);
      } else if (seenId === null) seenId = 0;
    } catch (e) {}
  };
  window.refreshNotes = refreshNotes;
  refreshNotes();
  setInterval(() => { if (!document.hidden) refreshNotes(); }, 8000);
}

/* The app needs the Flask server: warn if the page was opened as a plain file. */
if (location.protocol === "file:") {
  document.body.insertAdjacentHTML("afterbegin",
    `<p class="server-banner">TaskLink needs its server. Double-click start.bat, then open http://127.0.0.1:5000</p>`);
}

/* ---- Languages: French first, English second ---- */
let lang = "fr";
try { lang = localStorage.getItem("lang") === "en" ? "en" : "fr"; } catch (e) {}
document.documentElement.lang = lang;

const FR = {
  "Talk with the people you work with.": "Échange avec les personnes avec qui tu travailles.",
  "Decisions and updates about your account.": "Décisions et mises à jour concernant ton compte.",
  "Review reports and manage blocked accounts.": "Examine les signalements et gère les comptes bloqués.",
  /* menu and general */
  "Home": "Accueil", "Explore": "Explorer", "Messages": "Messages", "Profile": "Profil", "Search": "Rechercher",
  "Search ↗": "Rechercher ↗", "Cancel": "Annuler", "Save": "Enregistrer", "Close": "Fermer", "Delete": "Supprimer",
  "Other": "Autre", "Description": "Description", "Category": "Catégorie", "City": "Ville", "Type": "Type",
  "Service": "Service", "Services": "Services", "Training": "Formation", "Reviews": "Avis", "Message": "Message",
  "Loading…": "Chargement…", "You": "Moi", "To": "À",
  /* welcome, login, register */
  "Connecting skills to opportunities. Find trusted local services, share what you do, and turn ideas into action.":
    "Connecte les compétences aux opportunités. Trouve des services locaux de confiance, montre ce que tu sais faire et passe à l'action.",
  "Get started": "Commencer", "I already have an account": "J'ai déjà un compte", "Made for local talent · Cameroon": "Pour les talents locaux · Cameroun",
  "Welcome back": "Bon retour", "Log in": "Se connecter", "Log out": "Se déconnecter",
  "Sign in to find work, offer a service, or connect with local talent.": "Connecte-toi pour trouver du travail, proposer un service ou rencontrer des talents locaux.",
  "Email address": "Adresse e-mail", "Password": "Mot de passe", "New to TaskLink?": "Nouveau sur TaskLink ?",
  "Create an account": "Créer un compte", "Create your account": "Crée ton compte",
  "Join a community where skills turn into opportunities.": "Rejoins une communauté où les compétences deviennent des opportunités.",
  "Full name": "Nom complet", "Phone number": "Numéro de téléphone", "Your full name": "Ton nom complet",
  "At least 8 characters, with a letter and a digit": "Au moins 8 caractères, avec une lettre et un chiffre", "Create my account": "Créer mon compte", "Already have an account?": "Déjà un compte ?",
  /* home */
  "Hello there 👋": "Bonjour 👋", "What would you like to make happen today?": "Que veux-tu accomplir aujourd'hui ?",
  "Try “logo designer” or “how to save money”": "Ex. « graphiste logo » ou « comment économiser »",
  "Choose your next step": "Choisis ta prochaine étape", "Find a service": "Trouver un service", "Offer a service": "Proposer un service",
  "Do both": "Faire les deux", "Discover skills and training": "Découvre des compétences et des formations",
  "Share your skills": "Partage tes compétences", "Find missions or hire help": "Trouve des missions ou de l'aide",
  "Built around your community": "Au service de ta communauté", "Local talent. Real opportunities.": "Des talents locaux. De vraies opportunités.",
  "Browse services, post a mission, build your portfolio, and grow your reputation through reviews.":
    "Explore les services, publie une mission, construis ton portfolio et développe ta réputation grâce aux avis.",
  "Complete your profile": "Complète ton profil",
  /* services */
  "Search local skills, services and practical training.": "Cherche des compétences locales, des services et des formations pratiques.",
  "Ex: logo, how to save money...": "Ex : logo, comment économiser mon argent...", "All categories": "Toutes les catégories",
  "Offer your skills": "Propose tes compétences", "Service or training name": "Nom du service ou de la formation",
  "e.g. Logo design": "ex. Création de logo", "Describe what you offer": "Décris ce que tu proposes",
  "Starting price (FCFA)": "Prix de départ (FCFA)", "Add service": "Ajouter le service", "Service added!": "Service ajouté !",
  "View profile and call": "Voir le profil et appeler", "No services found.": "Aucun service trouvé.",
  "No services found. Add the first one below.": "Aucun service trouvé. Ajoute le premier ci-dessous.",
  "Design": "Design", "IT": "Informatique", "Education": "Éducation", "Sewing": "Couture", "Photo": "Photo", "Beauty": "Beauté",
  "Repair": "Réparation", "Finance": "Finance et investissement", "Business": "Business", "Content": "Création de contenu", "Coaching": "Coaching",
  /* missions */
  "Services and missions": "Services et missions", "Discover opportunities, apply to missions, or post a task you need help with.":
    "Découvre des opportunités, postule à des missions ou publie une tâche pour laquelle tu as besoin d'aide.",
  "Search services or missions...": "Services ou missions...", "Services and trainings": "Services et formations",
  "Open missions": "Missions ouvertes", "Post a mission": "Publier une mission", "Mission title": "Titre de la mission",
  "What do you need done?": "Que veux-tu faire faire ?", "Give the details and expectations": "Donne les détails et tes attentes",
  "Budget (FCFA)": "Budget (FCFA)", "Post mission": "Publier la mission", "Mission posted!": "Mission publiée !", "My missions": "Mes missions",
  "No open missions yet. Post the first one below.": "Aucune mission ouverte pour le moment. Publie la première ci-dessous.",
  "You have not posted any mission yet.": "Tu n'as pas encore publié de mission.",
  "Open": "Ouverte", "In progress": "En cours", "Done": "Terminée", "Apply": "Postuler", "Applied": "Candidature envoyée",
  "Accept": "Accepter", "Mark as done": "Marquer comme terminée", "Rate the worker": "Noter le prestataire",
  "Rating from 1 to 5": "Note de 1 à 5", "Comment (optional)": "Commentaire (facultatif)", "No applicants yet.": "Aucune candidature pour le moment.",
  "Applicants": "Candidats", "Worker": "Prestataire", "Posted by": "Publié par",
  /* messages */
  "Send to (email)": "Envoyer à (e-mail)", "Send message": "Envoyer le message", "No messages yet.": "Aucun message pour le moment.",
  "Message sent": "Message envoyé", "Write your message": "Écris ton message",
  /* profile */
  "Edit profile": "Modifier le profil", "Add a short bio so people get to know you.": "Ajoute une courte présentation pour qu'on te connaisse.",
  "+ Add skills": "+ Ajouter des compétences", "Works": "Réalisations", "Rating": "Note", "My portfolio": "Mon portfolio", "+ Add work": "+ Ajouter un travail",
  "Add your first work": "Ajoute ton premier travail", "Show clients what you can do.": "Montre aux clients ce que tu sais faire.",
  "Profile picture (JPG, PNG or WEBP, max 5 MB)": "Photo de profil (JPG, PNG ou WEBP, 5 Mo max)",
  "Choose a picture from your phone or computer. It will appear on your profile.": "Choisis une photo depuis ton téléphone ou ton ordinateur. Elle apparaîtra sur ton profil.",
  "About me": "À propos de moi", "Introduce yourself in a few words...": "Présente-toi en quelques mots...",
  "My skills (comma separated)": "Mes compétences (séparées par des virgules)", "Design, Video editing": "Design, Montage vidéo",
  "Add to portfolio": "Ajouter au portfolio", "Photo or video of your work": "Photo ou vidéo de ton travail",
  "Short description": "Courte description", "Ex: Logo for a bakery": "Ex : Logo pour une boulangerie", "Upload": "Envoyer",
  "My services": "Mes services", "No services yet.": "Aucun service pour le moment.", "+ Add a service": "+ Ajouter un service",
  "No reviews yet.": "Pas encore d'avis.", "Reviews received": "Avis reçus", "Delete this post?": "Supprimer cette publication ?",
  "Portfolio image": "Image du portfolio", "Portfolio": "Portfolio", "Nothing here yet.": "Rien ici pour le moment.",
  /* other people's profiles */
  "Report this profile": "Signaler ce profil", "No reviews yet": "Pas encore d'avis", "No portfolio items yet.": "Aucun travail dans le portfolio.",
  "No services listed yet.": "Aucun service proposé pour le moment.", "This provider has not added a bio yet.": "Ce prestataire n'a pas encore ajouté de présentation.",
  "Why are you reporting this profile?": "Pourquoi signales-tu ce profil ?", "Thank you. We will review this profile.": "Merci. Nous allons examiner ce profil.",
  /* messages from the server and the browser */
  "Please log in": "Connecte-toi d'abord", "Please complete all required fields": "Remplis tous les champs obligatoires",
  "Password must contain at least 6 characters": "Le mot de passe doit contenir au moins 6 caractères",
  "Password must contain at least 8 characters": "Le mot de passe doit contenir au moins 8 caractères",
  "Password must contain letters and at least one digit": "Le mot de passe doit contenir des lettres et au moins un chiffre",
  "Use lowercase letters only in the email address": "Utilise uniquement des minuscules dans l'adresse e-mail",
  "This password is too easy to guess": "Ce mot de passe est trop facile à deviner",
  "Enter your real full name (letters only, at least 2 characters)": "Entre ton vrai nom complet (lettres uniquement, 2 caractères minimum)", "Text is too long": "Le texte est trop long",
  "Enter a valid email address": "Entre une adresse e-mail valide", "Enter a valid phone number": "Entre un numéro de téléphone valide",
  "Choose a city from the list": "Choisis une ville dans la liste", "This email is already in use": "Cet e-mail est déjà utilisé",
  "Wrong email or password": "E-mail ou mot de passe incorrect", "Too many attempts. Try again in 10 minutes.": "Trop de tentatives. Réessaie dans 10 minutes.",
  "Name and city are required": "Le nom et la ville sont obligatoires", "The file is empty": "Le fichier est vide",
  "Choose a JPG, PNG or WEBP profile picture": "Choisis une photo de profil JPG, PNG ou WEBP",
  "Choose a JPG, PNG or WEBP image smaller than 5 MB": "Choisis une image JPG, PNG ou WEBP de moins de 5 Mo",
  "Profile pictures must be smaller than 5 MB": "Les photos de profil doivent faire moins de 5 Mo",
  "User not found": "Utilisateur introuvable", "No user found": "Utilisateur introuvable",
  "Choose a profile and provide a reason": "Choisis un profil et donne une raison", "Not allowed": "Action non autorisée",
  "Choose a category from the list": "Choisis une catégorie dans la liste", "Enter a valid price": "Entre un prix valide",
  "Enter a valid budget": "Entre un budget valide", "You cannot apply to this mission": "Tu ne peux pas postuler à cette mission",
  "Write a message first": "Écris d'abord un message", "You cannot message yourself": "Tu ne peux pas t'écrire à toi-même",
  "Use a JPG, PNG, WEBP, MP4, WEBM or MOV file": "Utilise un fichier JPG, PNG, WEBP, MP4, WEBM ou MOV",
  "File too large (max 30 MB)": "Fichier trop volumineux (30 Mo max)", "Upload failed": "Échec de l'envoi",
  "Profile picture upload failed": "Échec de l'envoi de la photo de profil", "Something went wrong": "Une erreur est survenue",
  "Not found": "Introuvable", "Method not allowed": "Méthode non autorisée", "Please send JSON data": "Données invalides",
  "Cannot reach the server. Is TaskLink running?": "Impossible de joindre le serveur. TaskLink est-il lancé ?",
  "TaskLink needs its server. Double-click start.bat, then open http://127.0.0.1:5000":
    "TaskLink a besoin de son serveur. Double-clique sur start.bat, puis ouvre http://127.0.0.1:5000",
  /* reviews */
  "Verified mission": "Mission vérifiée", "Leave a review": "Laisser un avis", "Edit your review": "Modifier ton avis",
  "Your rating": "Ta note", "Your comment": "Ton commentaire", "What do you think of their skill? Quality, speed, reliability...":
    "Que penses-tu de leur savoir-faire ? Qualité, rapidité, fiabilité...", "Publish review": "Publier l'avis", "Update review": "Mettre à jour l'avis",
  "Delete my review": "Supprimer mon avis", "Review published. Thank you!": "Avis publié. Merci !", "Review deleted": "Avis supprimé",
  "Delete your review?": "Supprimer ton avis ?", "Choose a rating from 1 to 5": "Choisis une note de 1 à 5",
  "Write a short comment about their skill (at least 5 characters)": "Écris un court commentaire sur leur savoir-faire (5 caractères minimum)",
  "You cannot review yourself": "Tu ne peux pas donner un avis sur toi-même",
  "Reviews help others confirm this person's skill.": "Les avis aident les autres à confirmer les compétences de cette personne.",
  "stars": "étoiles",
  /* chat */
  "Chat": "Discussion", "New chat": "Nouvelle discussion", "Start a chat by e-mail": "Démarrer une discussion par e-mail", "Start": "Démarrer",
  "Their e-mail address": "Son adresse e-mail", "No conversations yet. Open a profile and tap Message.": "Aucune discussion pour le moment. Ouvre un profil et appuie sur Message.",
  "Write a message…": "Écris un message…", "Send": "Envoyer", "Say hello 👋": "Dis bonjour 👋", "Back": "Retour", "You:": "Moi :",
  "Meet · 3D map": "Rencontre · carte 3D",
  /* map */
  "Meet on the map": "Se retrouver sur la carte", "Your meeting place": "Ton lieu de rencontre",
  "Walk": "À pied", "Bike": "Vélo", "Car": "Voiture", "3D view": "Vue 3D", "Fly along the route": "Survoler l'itinéraire", "Stop": "Arrêter",
  "Meet halfway": "Se retrouver à mi-chemin", "Remove meeting point": "Retirer le point de rencontre", "Use my current position": "Utiliser ma position actuelle",
  "Send meeting point in chat": "Envoyer le point de rencontre dans la discussion", "Meeting point sent": "Point de rencontre envoyé",
  "Route": "Itinéraire", "Directions": "Étapes", "Search a place or address": "Chercher un lieu ou une adresse", "Search a place": "Chercher un lieu",
  "Tap the map to choose a meeting point.": "Touche la carte pour choisir un point de rencontre.",
  "Choose where you are happy to meet people. Others only see it if you share it and you have chatted together.":
    "Choisis où tu veux bien rencontrer les gens. Les autres ne le voient que si tu le partages et que vous avez discuté ensemble.",
  "Share this place with people I chat with": "Partager ce lieu avec les personnes avec qui je discute", "Place name (optional)": "Nom du lieu (facultatif)",
  "Save place": "Enregistrer le lieu", "Remove my place": "Retirer mon lieu", "Place saved": "Lieu enregistré", "Place removed": "Lieu retiré",
  "Choose a place on the map": "Choisis un lieu sur la carte", "My meeting place": "Mon lieu de rencontre",
  "Set your place so people can plan a route to you.": "Indique ton lieu pour qu'on puisse préparer un itinéraire vers toi.",
  "This person has not shared a meeting place yet": "Cette personne n'a pas encore partagé de lieu de rencontre",
  "Send a message first, then you can see the route": "Envoie d'abord un message, tu pourras ensuite voir l'itinéraire",
  "Loading the 3D map…": "Chargement de la carte 3D…", "Could not load the map. Check your internet connection.": "Impossible de charger la carte. Vérifie ta connexion internet.",
  "No route found between these two points.": "Aucun itinéraire trouvé entre ces deux points.", "Could not get your position": "Impossible d'obtenir ta position",
  "No place found": "Aucun lieu trouvé", "Meeting point": "Point de rencontre", "Total": "Total",
  /* admin, reports, notifications */
  "Notifications": "Notifications", "No notifications yet.": "Aucune notification pour le moment.", "Mark all as read": "Tout marquer comme lu",
  "Admin": "Admin", "Admin panel": "Espace administrateur", "Reports": "Signalements", "Pending": "En attente", "Accepted": "Acceptés",
  "Rejected": "Refusés", "Blocked users": "Comptes bloqués", "Accept and block": "Accepter et bloquer", "Reject": "Refuser",
  "Admin message (optional)": "Message de l'administrateur (facultatif)", "Visible by the person who reported.": "Visible par la personne qui a signalé.",
  "Reported by": "Signalé par", "Reported profile": "Profil signalé", "Reason": "Motif", "View profile": "Voir le profil", "Unblock": "Débloquer",
  "No reports here.": "Aucun signalement ici.", "No blocked users.": "Aucun compte bloqué.", "Blocked": "Bloqué", "Phone": "Téléphone", "E-mail": "E-mail",
  "reports on this profile": "signalements sur ce profil", "report on this profile": "signalement sur ce profil", "Decision": "Décision", "Reviewed": "Examiné",
  "Block this account? The person will no longer be able to log in, and the reporter will be notified.":
    "Bloquer ce compte ? La personne ne pourra plus se connecter et le signalement sera notifié à l'auteur.",
  "Reject this report? The reporter will be notified.": "Refuser ce signalement ? L'auteur sera notifié.",
  "Unblock this account?": "Débloquer ce compte ?",
  "Decision saved. The reporter has been notified.": "Décision enregistrée. L'auteur du signalement a été notifié.",
  "Account unblocked": "Compte débloqué",
  "Thank you. An administrator will review this report and you will get a notification with the decision.":
    "Merci. Un administrateur va examiner ce signalement et tu recevras une notification avec sa décision.",
  "This account has been blocked by an administrator": "Ce compte a été bloqué par un administrateur",
  "You already reported this profile. An administrator is reviewing it.": "Tu as déjà signalé ce profil. Un administrateur l'examine.",
  "Choose accept or reject": "Choisis accepter ou refuser", "This report has already been reviewed": "Ce signalement a déjà été examiné",
  "An administrator account cannot be blocked": "Un compte administrateur ne peut pas être bloqué",
  /* chat attachments */
  "Attach a picture or a PDF": "Joindre une image ou un PDF", "Photo": "Photo", "PDF": "PDF", "Open": "Ouvrir", "Download": "Télécharger",
  "Remove": "Retirer", "Add a text (optional)": "Ajouter un texte (facultatif)",
  "Send a JPG, PNG, WEBP picture or a PDF": "Envoie une image JPG, PNG, WEBP ou un PDF",
  "Pictures must be smaller than 10 MB": "Les images doivent faire moins de 10 Mo", "PDF files must be smaller than 20 MB": "Les PDF doivent faire moins de 20 Mo",
  "This file type is not allowed": "Ce type de fichier n'est pas autorisé",
  /* path to a place */
  "Path to this place": "Chemin pour y aller", "Show the way from my position": "Afficher le chemin depuis ma position",
  "Open in Google Maps": "Ouvrir dans Google Maps", "Getting your position…": "Recherche de ta position…", "Your position": "Ta position",
  "Save the place first, or tap the map to choose it.": "Choisis d'abord un lieu sur la carte.", "Place": "Lieu",
  /* page titles */
  "Explore services": "Explorer les services", "Meet": "Rencontre", "My place": "Mon lieu", "Missions": "Missions", "Provider profile": "Profil du prestataire",
};
const PATTERNS = [
  [/^Hello, (.+)$/, "Bonjour, $1"], [/^From (.+) FCFA$/, "À partir de $1 FCFA"],
  [/^Budget: (.+) FCFA$/, "Budget : $1 FCFA"], [/^Call (.+)$/, "Appeler $1"],
  [/^★ (.+)\/5 \((\d+) reviews?\)$/, "★ $1/5 ($2 avis)"],
];
const t = (s) => {
  if (lang !== "fr" || !s) return s;
  const k = String(s).trim();
  if (Object.prototype.hasOwnProperty.call(FR, k)) return s.replace(k, FR[k]);
  for (const [re, to] of PATTERNS) if (re.test(k)) return s.replace(k, k.replace(re, to));
  return s;
};
const tNode = (n) => { const v = t(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v; };
function translate(root) {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) tNode(n);
  root.querySelectorAll("[placeholder]").forEach((el) => { el.placeholder = t(el.placeholder); });
}
const showError = (el, err) => { el.classList.remove("ok"); el.textContent = t(err && err.message ? err.message : String(err)); };
const showOk = (el, text) => { el.classList.add("ok"); el.textContent = t(text); };

document.body.insertAdjacentHTML("beforeend",
  `<button id="lang" type="button" aria-label="${lang === "fr" ? "Switch to English" : "Passer en français"}">${lang === "fr" ? "EN" : "FR"}</button>`);
document.getElementById("lang").onclick = () => {
  try { localStorage.setItem("lang", lang === "fr" ? "en" : "fr"); } catch (e) {}
  location.reload();
};
if (lang === "fr") {
  document.title = document.title.split(" — ").map(t).join(" — ");
  new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => {
    if (n.nodeType === 3) tNode(n); else if (n.nodeType === 1) translate(n);
  }))).observe(document.body, { childList: true, subtree: true });
  translate(document.body);
}
