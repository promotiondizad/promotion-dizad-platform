'use strict';
/* i18n — ترجمة حية للواجهة (عربي ⇄ فرنسي). القاموس يترجم نصوص الواجهة فقط؛
   أسماء المنتجات وأوصافها بيانات التجار وتبقى بلغتها الأصلية. */
const I18N_FR = {
  // تنقل عام
  'الرئيسية': 'Accueil', 'الأقسام': 'Catégories', 'السلة': 'Panier', 'حسابي': 'Mon compte', 'المفضلة': 'Favoris', 'المزيد': 'Plus', 'القائمة': 'Menu',
  'دخول / تسجيل': 'Connexion / Inscription', 'دخول': 'Connexion', 'خروج': 'Déconnexion', 'تسجيل الدخول': 'Se connecter', 'إنشاء الحساب': 'Créer le compte', 'حساب جديد': 'Nouveau compte',
  'إشعاراتي': 'Mes notifications', 'طلباتي': 'Mes commandes', 'لوحتي': 'Mon tableau de bord', 'تتبع طلبك': 'Suivre votre commande', 'تتبّع طلبك': 'Suivre votre commande',
  '📦 تتبع طلبي': '📦 Suivre ma commande', '📦 تتبّع طلبك خطوة بخطوة': '📦 Suivez votre commande étape par étape', 'تتبّع طلبك في كل مرحلة': 'Suivez votre commande à chaque étape',
  // الرئيسية والبانر
  'كل ما تحتاجه': 'Tout ce qu’il vous faut', 'في مكان واحد': 'en un seul endroit', 'منتجات أصلية .. أسعار مميزة': 'Produits authentiques · Prix imbattables',
  'تسوق الآن ‹': 'Acheter ›', 'تسوق الآن': 'Acheter maintenant', 'تسوق بذكاء · لحياة أفضل': 'Achetez malin · Pour une vie meilleure',
  '🚚 توصيل سريع': '🚚 Livraison rapide', '🛡️ دفع آمن': '🛡️ Paiement sécurisé', '🎧 خدمة عملاء مميزة': '🎧 Service client premium',
  'دفع آمن عند الاستلام': 'Paiement sécurisé à la livraison', 'لا تدفع شيئاً قبل وصول طلبك': 'Ne payez rien avant de recevoir votre commande',
  'توصيل لـ58 ولاية': 'Livraison dans les 58 wilayas', 'منزل أو مكتب، حسب ولايتك وبلديتك': 'Domicile ou bureau, selon votre wilaya et commune',
  'حسابات منفصلة لكل دور': 'Des comptes séparés pour chaque rôle', 'مورد · تاجر جملة · مسوّق · زبون': 'Fournisseur · Grossiste · Marketeur · Client',
  'من التأكيد حتى التسليم والتحصيل': 'De la confirmation à la livraison et l’encaissement',
  '📣 سجّل كمسوّق واربح عمولة': '📣 Devenez marketeur et gagnez', '🏭 سجّل كمورّد وبِع منتجاتك': '🏭 Devenez fournisseur et vendez vos produits',
  '🗂️ تسوق حسب القسم': '🗂️ Acheter par catégorie', '🆕 وصل حديثاً': '🆕 Nouveautés', '🔥 الأكثر مبيعاً': '🔥 Meilleures ventes', 'الأكثر مبيعاً': 'Meilleures ventes',
  'كل المنتجات المعتمدة': 'Tous les produits approuvés', 'عرض الكل ‹': 'Tout voir ›', 'عرض التفاصيل': 'Voir les détails',
  'جارٍ تحميل المنتجات…': 'Chargement des produits…', 'لا توجد منتجات معتمدة معروضة حالياً. المنتجات تظهر هنا بعد مراجعة الإدارة للموردين ومنتجاتهم.': 'Aucun produit approuvé pour le moment. Les produits apparaissent ici après validation par l’administration.',
  'مفضلتك فارغة — اضغط 🤍 على أي منتج لإضافته هنا.': 'Vos favoris sont vides — touchez 🤍 sur un produit pour l’ajouter ici.',
  // البحث والفلاتر
  '🔍 ابحث عن منتج، ماركة أو فئة…': '🔍 Rechercher un produit, une marque ou une catégorie…', '🔍 ابحث باسم المنتج أو القسم…': '🔍 Rechercher par nom ou catégorie…',
  'كل التصنيفات': 'Toutes les catégories', 'كل الأسعار': 'Tous les prix', 'أقل من 1000 دج': 'Moins de 1000 DA', 'أكثر من 5000 دج': 'Plus de 5000 DA',
  'الترتيب: الأحدث': 'Tri : plus récents', 'الأعلى تقييماً': 'Mieux notés', 'السعر: من الأقل': 'Prix : croissant', 'السعر: من الأعلى': 'Prix : décroissant',
  '🤍 مفضلتي': '🤍 Mes favoris', '❤️ مفضلتي (معروضة)': '❤️ Mes favoris (affichés)', 'تعرض مفضلتك فقط ❤️': 'Vos favoris uniquement ❤️', 'تعرض كل المنتجات': 'Tous les produits affichés',
  // بطاقات وصفحة المنتج
  '🛒 أضف إلى السلة': '🛒 Ajouter au panier', 'أضف إلى السلة': 'Ajouter au panier', 'أُضيف إلى السلة': 'Ajouté au panier', 'اشترِ الآن': 'Acheter maintenant', '⚡ اشترِ الآن': '⚡ Acheter',
  '→ رجوع': 'Retour →', 'اضغط للتكبير': 'Touchez pour zoomer', 'لا صور لهذا المنتج': 'Aucune photo pour ce produit',
  '✔ متوفر في المخزون': '✔ En stock', 'متوفر في المخزون': 'En stock', 'نفد المخزون': 'Rupture de stock', 'المخزون': 'Stock', 'منتج': 'produit',
  'وصف المنتج': 'Description du produit', 'عرض التفاصيل ←': 'Voir les détails →', '📝 وصف المنتج': '📝 Description du produit', '⭐ تقييمات المشترين': '⭐ Avis des clients', '⭐ تقييمات منتجات هذا المتجر': '⭐ Avis sur les produits de cette boutique', 'الوصف الكامل': 'Description complète', 'منتجات مماثلة': 'Produits similaires', 'إرجاع سهل': 'Retour facile', 'خلال 7 أيام': 'Sous 7 jours',
  'دفع آمن': 'Paiement sécurisé', 'عند الاستلام': 'À la livraison', 'توصيل سريع': 'Livraison rapide',
  '🤍 أضف للمفضلة': '🤍 Ajouter aux favoris', '❤️ في المفضلة': '❤️ Dans vos favoris', 'أُضيف إلى المفضلة ❤️': 'Ajouté aux favoris ❤️', 'أُزيل من المفضلة': 'Retiré des favoris',
  'المتجر:': 'Boutique :', 'المورد:': 'Fournisseur :', 'المشتري:': 'Client :', 'قسم': 'Catégorie',
  // السلة وإتمام الطلب
  '🛒 السلة': '🛒 Panier', 'سلة الطلبات': 'Panier', 'السلة فارغة': 'Le panier est vide', 'السلة فارغة — أضف منتجاً أولاً': 'Panier vide — ajoutez d’abord un produit',
  'إتمام الطلب ←': 'Finaliser la commande ←', '🧾 إتمام الطلب': '🧾 Finaliser la commande', 'تأكيد الطلب — الدفع عند الاستلام': 'Confirmer — Paiement à la livraison',
  'جارٍ إنشاء الطلب…': 'Création de la commande…', 'تم إنشاء طلبك بنجاح:': 'Votre commande a été créée :',
  'مجموع المنتجات': 'Sous-total produits', 'مجموع المنتجات:': 'Sous-total produits :', 'التوصيل': 'Livraison', 'التوصيل:': 'Livraison :', 'الإجمالي': 'Total', 'الإجمالي عند الاستلام': 'Total à la livraison', 'الإجمالي عند الاستلام:': 'Total à la livraison :',
  'بالتوفيق!': 'Bonne chance !', 'بالضغط على تأكيد تُنشأ طلبية رسمية برقم مرجعي. لا توجد أي تكاليف مخفية: سعر المنتجات + التوصيل فقط.': 'En confirmant, une commande officielle avec numéro de suivi est créée. Aucun frais caché : produits + livraison uniquement.',
  'بيانات التوصيل': 'Informations de livraison', '🏠 توصيل إلى المنزل': '🏠 Livraison à domicile', '🏢 توصيل إلى مكتب شركة التوصيل': '🏢 Livraison au bureau du transporteur',
  'اختر الولاية': 'Choisissez la wilaya', 'اختر الولاية ثم البلدية': 'Choisissez la wilaya puis la commune', 'البلدية — اختر من القائمة أو اكتب': 'Commune — choisissez ou écrivez',
  'العنوان': 'Adresse', 'العنوان (حي، شارع، معلم…)': 'Adresse (quartier, rue, repère…)', 'عنوان التوصيل بالتفصيل': 'Adresse de livraison détaillée',
  'اسم المشتري': 'Nom du client', 'رقم الهاتف': 'Numéro de téléphone', 'رقم الهاتف المستعمل في الطلب': 'Téléphone utilisé pour la commande',
  'رقم الطلب مثال PD-2026-000001': 'N° de commande, ex. PD-2026-000001', 'تتبع': 'Suivre', 'تتبّع الآن': 'Suivre maintenant',
  'أدخل الرقم المرجعي الذي وصلك عند تأكيد الطلب ورقم الهاتف المستعمل فيه — تظهر لك المرحلة الحالية والسجل الزمني الكامل وتفاصيل المنتجات والمبالغ.': 'Entrez le numéro de suivi reçu à la confirmation et le téléphone de la commande pour voir l’étape actuelle, l’historique complet et les montants.',
  // الدخول والتسجيل
  'اختر نوع الحساب': 'Choisissez le type de compte', 'الاسم الكامل': 'Nom complet', 'الاسم': 'Nom', 'كلمة المرور': 'Mot de passe', 'كلمة المرور (8 أحرف على الأقل)': 'Mot de passe (8 caractères min.)', '8 أحرف على الأقل': '8 caractères minimum',
  'تأكيد كلمة المرور': 'Confirmez le mot de passe', 'كلمة المرور الحالية': 'Mot de passe actuel', 'كلمة المرور الجديدة': 'Nouveau mot de passe', 'تأكيد كلمة المرور الجديدة': 'Confirmez le nouveau mot de passe',
  'البريد الإلكتروني': 'E-mail', 'البريد الإلكتروني (اختياري)': 'E-mail (optionnel)', 'البريد الإلكتروني المسجل': 'E-mail enregistré', 'رقم هاتف الحساب': 'Téléphone du compte',
  'أوافق على': 'J’accepte', 'الشروط والأحكام': 'les conditions générales', '📜 الشروط والأحكام': '📜 Conditions générales', 'شروط الاستخدام': 'Conditions d’utilisation',
  '🔒 سياسة الخصوصية': '🔒 Politique de confidentialité', 'سياسة الخصوصية': 'Politique de confidentialité', 'الشروط': 'Conditions',
  'استعادة كلمة المرور': 'Récupérer le mot de passe', 'إرسال رمز الاستعادة': 'Envoyer le code de récupération', 'رمز الاستعادة الذي وصلك (6 أرقام)': 'Code de récupération reçu (6 chiffres)',
  'برقم الهاتف': 'Par téléphone', 'بالبريد الإلكتروني': 'Par e-mail', 'نفس الرقم أو البريد المستعمل أعلاه': 'Même numéro ou e-mail que ci-dessus',
  'نسيت كلمة المرور؟ اختر كيف يصلك رمز الاستعادة (6 أرقام): برقم هاتفك (تيليغرام/واتساب حسب حسابك) أو ببريدك الإلكتروني المسجل.': 'Mot de passe oublié ? Choisissez comment recevoir le code (6 chiffres) : par téléphone (Telegram/WhatsApp selon le compte) ou par votre e-mail enregistré.',
  'تغيير كلمة المرور': 'Changer le mot de passe', 'حفظ التعديلات': 'Enregistrer les modifications', 'تم تسجيل الخروج': 'Vous êtes déconnecté', 'أُنهيت الجلسة': 'Session terminée',
  'اسم النشاط/المتجر': 'Nom de l’activité / boutique', 'اسم المؤسسة / النشاط التجاري': 'Nom de l’entreprise / activité', 'معلومات النشاط (ماذا تبيع؟)': 'Infos activité (que vendez-vous ?)',
  'الولاية (اختياري عند التسجيل)': 'Wilaya (optionnel à l’inscription)', 'حساب مشتري: اطلب وتابع طلباتك وسجل مشترياتك.': 'Compte client : commandez et suivez vos commandes et achats.',
  'حساب مسوق: تسويق يدوي بلا روابط — سوّق بنفسك وأدخل طلبات زبائنك بسعرك، عمولات موثقة تُثبت بعد التسليم والتحصيل فقط.': 'Compte marketeur : marketing manuel sans liens — vendez vous-même, saisissez les commandes de vos clients à votre prix ; commissions validées uniquement après livraison et encaissement.',
  'حساب مورد: تُراجع الإدارة حسابك أولاً، ثم تنشر منتجاتك وتستقبل الطلبات الموجهة إليك آلياً.': 'Compte fournisseur : l’administration valide d’abord votre compte, puis vous publiez vos produits et recevez automatiquement les commandes.',
  'حساب المورد يُراجَع من الإدارة قبل تفعيل نشر المنتجات واستقبال الطلبات.': 'Le compte fournisseur est validé par l’administration avant l’activation de la publication et des commandes.',
  'حسابك قيد مراجعة الإدارة — ستُفعَّل صلاحيات النشر واستقبال الطلبات بعد الاعتماد.': 'Votre compte est en cours de validation — la publication et les commandes seront activées après approbation.',
  'مرحباً': 'Bienvenue', 'سجّل الدخول أولاً لمتابعة المتجر': 'Connectez-vous d’abord pour suivre la boutique',
  // الأدوار والحالات
  'المشتري': 'Client', 'المسوق': 'Marketeur', 'مسوّق': 'Marketeur', 'المورد': 'Fournisseur', 'مورّد': 'Fournisseur', 'زبون': 'Client',
  'حالة الطلب': 'Statut de la commande', 'حالة العمولة': 'Statut de la commission', 'الحالة': 'Statut', 'التاريخ': 'Date', 'التاريخ:': 'Date :', 'الرقم': 'N°',
  'طلب جديد': 'Nouvelle commande', 'جديد — بانتظار تأكيد المورد': 'Nouveau — en attente du fournisseur', 'مؤكد': 'Confirmée', 'مؤكد من المورد': 'Confirmée par le fournisseur',
  'قيد التجهيز': 'En préparation', 'قيد التجهيز لدى المورد': 'En préparation chez le fournisseur', 'سُلّم لشركة التوصيل': 'Remis au transporteur', 'تم تسليمه لشركة التوصيل': 'Remis au transporteur',
  'خرج للتوصيل': 'En cours de livraison', 'في التوصيل 🚚': 'En livraison 🚚', 'تم التسليم والتحصيل': 'Livré et encaissé', 'تم التسليم أو الإرجاع أو الإلغاء': 'Livré, retourné ou annulé',
  'قيد الانتظار ⏳': 'En attente ⏳', 'قيد المعالجة ⏳': 'En traitement ⏳', 'بانتظار المراجعة': 'En attente de validation', 'معتمد': 'Approuvé', 'مرفوض': 'Refusé', 'ملغاة': 'Annulée', 'مرتجع': 'Retourné', 'موقوف': 'Suspendu',
  'أُلغي هذا الطلب': 'Commande annulée', 'رُجع هذا الطلب': 'Commande retournée', 'رُفض هذا الطلب من المورد': 'Commande refusée par le fournisseur',
  'تعذر التسليم': 'Échec de livraison', 'تعذر التسليم — المورد يعيد المحاولة أو يرجع الطلب': 'Échec de livraison — le fournisseur réessaie ou retourne la commande',
  'أُلغي الطلب': 'Commande annulée', 'تم تأكيد الطلب': 'Commande confirmée', 'مدفوعة ✅': 'Payée ✅', 'موافق عليها 💰': 'Approuvée 💰',
  // لوحات ومحفظة
  '📊 نظرة عامة': '📊 Aperçu', 'عمولتي': 'Ma commission', 'عمولتك من هذه الطلبية': 'Votre commission sur cette commande', 'عمولات المسوق الكلية': 'Commissions totales du marketeur',
  'هامش المنصة الكلي': 'Marge totale de la plateforme', 'صافي المنصة': 'Net plateforme', 'مجموع الجملة (للمورد)': 'Total gros (fournisseur)',
  '🚚 أسعار التوصيل': '🚚 Tarifs de livraison', 'أسعار التوصيل': 'Tarifs de livraison', 'حُفظت تغطية التوصيل': 'Couverture de livraison enregistrée',
  'اسم المنتج': 'Nom du produit', 'المنتج': 'Produit', 'المنتجات': 'Produits', 'حُفظت تعديلات المنتج': 'Modifications du produit enregistrées',
  'روابط صور إضافية مفصولة بفواصل (اختياري)': 'Liens d’images supplémentaires, séparés par des virgules (optionnel)',
  'المقاسات مفصولة بفواصل (اختياري)': 'Tailles séparées par des virgules (optionnel)', 'الألوان مفصولة بفواصل (اختياري)': 'Couleurs séparées par des virgules (optionnel)',
  'مقاس': 'Taille', 'سبب (إلزامي عند الرفض/الإلغاء)': 'Motif (obligatoire en cas de refus/annulation)', 'رقم تتبع الشحنة (اختياري)': 'N° de suivi du colis (optionnel)',
  'تفاصيل الاستلام': 'Détails de réception', 'الاسم الكامل ورقم هاتفك': 'Nom complet et votre téléphone', 'الاسم الكامل ورقم هاتفك — الاستلام من مقر المنصة': 'Nom complet et téléphone — retrait au siège de la plateforme',
  'الاسم الكامل، العنوان، الهاتف': 'Nom complet, adresse, téléphone', 'رقم الحساب / الهاتف المرتبط بالوسيلة': 'N° de compte / téléphone lié au moyen',
  'رقم الحساب البريدي الجاري والمفتاح (CCP)': 'N° CCP et clé', 'RIB بريدي موب (20 رقماً)': 'RIB BaridiMob (20 chiffres)', 'رقم هاتفك Flexy': 'Votre numéro Flexy',
  'تحويل بريدي موب': 'BaridiMob', 'تحويل البريد الجاري': 'Virement CCP', 'التحصيل من مقر المنصة': 'Retrait au siège de la plateforme', 'نقداً عند الاستلام من الإدارة': 'Espèces auprès de l’administration',
  'مثال: 123456789': 'Ex. : 123456789', 'لا منتجات في هذه الطلبية': 'Aucun produit dans cette commande', 'لا صور لهذا المنتج': 'Aucune photo', 'غير متوفر حالياً:': 'Actuellement indisponible :',
  'شكراً! نُشر تقييمك ✓': 'Merci ! Votre avis est publié ✓', 'اختر عدد النجوم أولاً': 'Choisissez d’abord le nombre d’étoiles',
  '🎓 تدريب المسوقين': '🎓 Formation des marketeurs', 'تدريب المسوقين': 'Formation des marketeurs', '✉️ الدعم والتواصل': '✉️ Support et contact', 'الدعم والتواصل': 'Support et contact',
  'تواصل معنا': 'Contactez-nous', 'تواصل معنا عبر واتساب': 'Contactez-nous sur WhatsApp', 'واتساب': 'WhatsApp', '💬 واتساب': '💬 WhatsApp', 'مشاركة تيليغرام': 'Partager sur Telegram',
  'صفحة فيسبوك الرسمية': 'Page Facebook officielle', 'رسالتك…': 'Votre message…', 'خطأ': 'Erreur', 'إعادة المحاولة': 'Réessayer',
  '⚠️ تعذّر الاتصال بالخادم — قد يكون متوقفاً مؤقتاً. تحقق من اتصالك وحاول مجدداً.': '⚠️ Serveur injoignable — il est peut-être arrêté temporairement. Vérifiez votre connexion et réessayez.',
  'الأسئلة الشائعة': 'Questions fréquentes', '❓ الأسئلة الشائعة': '❓ Questions fréquentes',
  'منصة جزائرية للتجارة والتسويق بالعمولة: منتجات مختارة من موردين موثوقين، دفع عند الاستلام، وتتبّع مباشر لطلبك خطوة بخطوة.': 'Plateforme algérienne de commerce et de marketing d’affiliation : produits sélectionnés de fournisseurs fiables, paiement à la livraison et suivi en direct de votre commande.',
  'سوّق المنتجات واربح عمولات حرة': 'Vendez les produits et gagnez des commissions libres', 'اعرض منتجاتك وطوّر عملك': 'Présentez vos produits et développez votre activité',
  'تسوّق من منتجات المورّدين وتابع طلباتك': 'Achetez les produits des fournisseurs et suivez vos commandes', 'شكراً لثقتكم — SOUQAR': 'Merci de votre confiance — SOUQAR',
  'خريطة الجزائر': 'Carte de l’Algérie', 'الوضع المظلم / الفاتح': 'Mode sombre / clair', 'أنت الآن تتابع هذا المتجر ✓': 'Vous suivez cette boutique ✓', '✓ تتابع هذا المتجر': '✓ Boutique suivie', '➕ متابعة المتجر': '➕ Suivre la boutique', 'ألغيت المتابعة': 'Vous ne suivez plus la boutique', 'متابِع': 'Abonné',
  'نُسخ رابط الدعوة': 'Lien d’invitation copié', 'نُسخ الوصف بلا سعر — أضف سعرك أنت في إعلانك': 'Description copiée sans prix — ajoutez le vôtre dans votre annonce',
  'نُسخ وصف المنتج — الصقه في إعلانك': 'Description copiée — collez-la dans votre annonce', 'نُسخ الوصل ✓': 'Reçu copié ✓', 'نُسخ الوصل — الصقه أين تشاء ✓': 'Reçu copié — collez-le où vous voulez ✓',
  'تعذّر النسخ': 'Copie impossible', 'تعذّر النسخ التلقائي — حدّد النص يدوياً وانسخه': 'Copie automatique impossible — sélectionnez le texte manuellement',
  'تعذّر النسخ — انسخ الرابط يدوياً': 'Copie impossible — copiez le lien manuellement', 'المشاركة غير متاحة هنا': 'Partage indisponible ici',
  'المتصفح منع التحميل المباشر — افتح المنتج واضغط مطولاً على صوره في المعرض لحفظها': 'Le navigateur a bloqué le téléchargement direct — ouvrez le produit et appuyez longuement sur ses photos pour les enregistrer',
  'صورة — استعملها في إعلاناتك': 'Photo — utilisez-la dans vos annonces', 'حُمّلت': 'Téléchargée', 'وصل طلبية': 'Nouvelle commande', 'SOUQAR — وصل طلبية': 'SOUQAR — Nouvelle commande',
  'بيع مباشر بلا مسوق': 'Vente directe sans marketeur', 'انضم معي لمسوّقي SOUQAR واربح من التسويق بالعمولة:': 'Rejoins les marketeurs SOUQAR et gagne avec le marketing d’affiliation :',
  'معرف محادثة تيليغرام Chat ID لإشعارات الطلبات (اختياري)': 'Chat ID Telegram pour les notifications de commandes (optionnel)',
  'وضع التعديل — عدّل ثم اضغط «حفظ التعديلات» (تغيير الاسم أو السعر يعيد المنتج لمراجعة الإدارة، والمخزون وحده لا يعيده)': 'Mode édition — modifiez puis touchez « Enregistrer » (changer le nom ou le prix renvoie le produit en validation ; le stock seul ne le fait pas)',
  '✏️ تعديل منتج:': '✏️ Modifier le produit :',
  // أسماء الأقسام (بيانات — تُترجم كواجهة)
  'مطبخ وطعام': 'Cuisine & Alimentation', 'أجهزة كهرومنزلية وتكييف': 'Électroménager & Climatisation', 'مستلزمات الدراجات والشتاء': 'Moto & Hiver', 'المنزل والتنظيم': 'Maison & Rangement', 'إلكترونيات وصوتيات': 'Électronique & Audio', 'أطفال ورضّع': 'Enfants & Bébés', 'ملابس وإكسسوارات': 'Vêtements & Accessoires', 'صحة وجمال': 'Santé & Beauté', 'عام': 'Divers',
  '● متوفر': '● Disponible', '❤️ المفضلة': '❤️ Favoris', 'كل الأقسام': 'Toutes les catégories', 'تسوّق من منتجات المورّدين وتابع طلباتك': 'Achetez les produits des fournisseurs et suivez vos commandes', 'سوّق المنتجات واربح عمولات حرة': 'Vendez les produits et gagnez des commissions libres', '📣 سجّل كمسوّق واربح عمولة': '📣 Inscrivez-vous comme vendeur et gagnez des commissions', '🔎 عرض مُصفّى — أقسام المتجر مخفية مؤقتاً': '🔎 Affichage filtré — les sections sont masquées temporairement', '✕ إظهار كل شيء': '✕ Tout afficher', 'تعرض كل المنتجات والأقسام': 'Tous les produits et sections affichés',
  // عملة
  'دج': 'DA', 'الكمية': 'Quantité', 'نُسخ رابط المنتج ✓': 'Lien du produit copié ✓',
  // الولايات
  'أدرار': 'Adrar', 'الأغواط': 'Laghouat', 'أم البواقي': 'Oum El Bouaghi', 'باتنة': 'Batna', 'بجاية': 'Béjaïa', 'بسكرة': 'Biskra', 'بشار': 'Béchar', 'البليدة': 'Blida', 'البويرة': 'Bouira', 'تمنراست': 'Tamanrasset', 'تبسة': 'Tébessa', 'تلمسان': 'Tlemcen', 'تيارت': 'Tiaret', 'تيزي وزو': 'Tizi Ouzou', 'الجزائر': 'Alger', 'الجلفة': 'Djelfa', 'جيجل': 'Jijel', 'سطيف': 'Sétif', 'سعيدة': 'Saïda', 'سكيكدة': 'Skikda', 'سيدي بلعباس': 'Sidi Bel Abbès', 'عنابة': 'Annaba', 'قالمة': 'Guelma', 'قسنطينة': 'Constantine', 'المدية': 'Médéa', 'مستغانم': 'Mostaganem', 'المسيلة': 'M’Sila', 'معسكر': 'Mascara', 'ورقلة': 'Ouargla', 'وهران': 'Oran', 'البيض': 'El Bayadh', 'إليزي': 'Illizi', 'برج بوعريريج': 'Bordj Bou Arréridj', 'بومرداس': 'Boumerdès', 'الطارف': 'El Tarf', 'تندوف': 'Tindouf', 'تيسمسيلت': 'Tissemsilt', 'الوادي': 'El Oued', 'خنشلة': 'Khenchela', 'سوق أهراس': 'Souk Ahras', 'تيبازة': 'Tipaza', 'ميلة': 'Mila', 'عين الدفلى': 'Aïn Defla', 'النعامة': 'Naâma', 'عين تموشنت': 'Aïn Témouchent', 'غرداية': 'Ghardaïa', 'غليزان': 'Relizane', 'الشلف': 'Chlef', 'تيميمون': 'Timimoun', 'برج باجي مختار': 'Bordj Badji Mokhtar', 'أولاد جلال': 'Ouled Djellal', 'بني عباس': 'Béni Abbès', 'عين صالح': 'In Salah', 'عين قزام': 'In Guezzam', 'تقرت': 'Touggourt', 'جانت': 'Djanet', 'المغير': 'El M’Ghair', 'المنيعة': 'El Meniaa'
};

let PD_LANG = 'ar';
try { PD_LANG = localStorage.getItem('pd_lang') || 'ar'; } catch {}
const _origText = new Map();   // عقدة نصية ← نصها العربي الأصلي
const _origAttr = new Map();   // عنصر ← {attr: الأصلي}
let _applying = false;

function _trValue(raw) {
  const t = raw.trim();
  if (!t) return null;
  if (Object.prototype.hasOwnProperty.call(I18N_FR, t)) {
    return raw.replace(t, I18N_FR[t]);
  }
  const rng = t.match(/^([\d][\d\s.,–-]*)\s*دج$/);
  if (rng) return raw.replace(t, rng[1].trim() + ' DA');
  const left = t.match(/^بقي ([\d\s]+) فقط$/);
  if (left) return raw.replace(t, 'Plus que ' + left[1].trim());
  const cnt = t.match(/^(.+?) \(([\d\s]+)\)$/);
  if (cnt && Object.prototype.hasOwnProperty.call(I18N_FR, cnt[1])) return raw.replace(t, I18N_FR[cnt[1]] + ' (' + cnt[2] + ')');
  return null;
}
function _walkFr(root) {
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      const p = n.parentElement;
      if (!p || p.closest('script,style,textarea')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const nodes = [];
  while (tw.nextNode()) nodes.push(tw.currentNode);
  for (const n of nodes) {
    if (!_origText.has(n)) _origText.set(n, n.nodeValue);
    const v = _trValue(n.nodeValue);
    if (v !== null && v !== n.nodeValue) n.nodeValue = v;
  }
  root.querySelectorAll('[placeholder],[title]').forEach((el) => {
    for (const a of ['placeholder', 'title']) {
      const cur = el.getAttribute(a);
      if (!cur) continue;
      let rec = _origAttr.get(el);
      if (!rec) { rec = {}; _origAttr.set(el, rec); }
      if (!(a in rec)) rec[a] = cur;
      const v = _trValue(cur);
      if (v !== null && v !== cur) el.setAttribute(a, v);
    }
  });
}
function _restoreAr() {
  for (const [n, v] of _origText) { try { n.nodeValue = v; } catch {} }
  _origText.clear();
  for (const [el, rec] of _origAttr) { for (const a in rec) { try { el.setAttribute(a, rec[a]); } catch {} } }
  _origAttr.clear();
}
function applyI18n() {
  if (_applying || !document.body) return;
  _applying = true;
  try { if (PD_LANG === 'fr') _walkFr(document.body); } finally { _applying = false; }
}
function setLang(l) {
  PD_LANG = l === 'fr' ? 'fr' : 'ar';
  try { localStorage.setItem('pd_lang', PD_LANG); } catch {}
  document.documentElement.lang = PD_LANG;
  document.documentElement.dir = PD_LANG === 'fr' ? 'ltr' : 'rtl';
  const b = document.getElementById('langBtn');
  if (b) b.textContent = PD_LANG === 'fr' ? '🌐 عربي' : '🌐 FR';
  if (PD_LANG === 'fr') applyI18n(); else _restoreAr();
}
document.addEventListener('DOMContentLoaded', () => {
  const b = document.getElementById('langBtn');
  if (b) b.addEventListener('click', () => setLang(PD_LANG === 'fr' ? 'ar' : 'fr'));
  if (PD_LANG === 'fr') setLang('fr');
  let t = null;
  new MutationObserver(() => {
    if (_applying || PD_LANG !== 'fr') return;
    clearTimeout(t); t = setTimeout(applyI18n, 60);
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
});
