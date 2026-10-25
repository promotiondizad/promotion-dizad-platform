'use strict';
// خريطة تصنيف منتجات المتجر لأقسام حقيقية — قواعد كلمات مفتاحية مرتبة بالأولوية (الأخصّ أولاً).
// تُستعمل في: بذر الكتالوج (scripts/seed-from-store.js) وإعادة تصنيف البيانات الحية (scripts/recategorize.js).
const CATEGORY_RULES = [
  ['أطفال ورضّع', ['enfant', 'bébé', 'bebe', 'baby', 'أطفال', 'رضّع', 'رضيع', 'زجاجات الأطفال', 'frozen', 'jouet', 'peluche', 'babyfoot', 'dentition', 'mouche bébé', 'biberon']],
  ['مستلزمات الدراجات والشتاء', ['moto', 'دراجة', 'cagoule', 'gants', 'scooter', 'biker', 'قناع وجه', 'قفازات', 'capuche']],
  ['إلكترونيات وصوتيات', ['bluetooth', 'سماعات', 'ساعة ذكية', 'projecteur', 'chargeur', 'شاحن', 'carplay', 'haut parleur', 'مكبر صوت', 'fibre optique', 'réveil', 'سماعة']],
  ['صحة وجمال', ['massage', 'تدليك', 'thérapie', 'علاج']],
  ['أجهزة كهرومنزلية وتكييف', ['كهرومنزلي', 'machine à laver', 'غسالة', 'مروحة', 'ventilat', 'chauffage', 'مدفأة', 'aspirateur', 'مكنسة', 'fer à repasser', 'مكواة', 'machine à café', 'ماكينة قهوة', 'cafetière', 'refroidisseur', 'تبريد', 'climatiseur', 'tower fan']],
  ['ملابس وإكسسوارات', ['chaussure', 'bonnet', 'حذاء', 'ملابس']],
  ['مطبخ وطعام', ['مطبخ', 'cuisine', 'épices', 'توابل', 'بهارات', 'couteau', 'سكاكين', 'aiguiseur', 'شحذ', 'extracteur', 'عصّارة', 'عصارة', 'presse agrume', 'presse-agrumes', 'presse agrume', 'mixeur', 'خلاط', 'hachoir', 'مفرمة', 'mandoline', 'قطاعة', 'تقطيع', 'trancheuse', 'râpe', 'cuiseur', 'طهي', 'marmite', 'مقلاة', 'poêle', 'gril', 'شواية', 'lunch', 'حافظة طعام', 'isotherme', 'casseroles', 'أواني', 'vaisselle', 'الأطباق', 'éponge', 'حوض', 'évier', 'صنبور', 'robinet', 'capsules', 'كبسولات', 'café', 'قهوة', 'mousseur', 'رغوة الحليب', 'oeuf', 'البيض', 'fruits', 'فواكه', 'légumes', 'خضروات', 'خضر ', 'pâtes', 'عجائن', 'film alimentaire', 'distributeur d’eau', 'distributeur d\'eau', 'موزع المياه', 'mesures', 'مقادير', 'ouvre-boîte', 'فتاحة العلب', 'herbes', 'أعشاب', 'éplucheur', 'مقشرة', 'plumeuse', 'نتف ريش', 'تنشيف', 'تجفيف الأواني', 'تقطير الأواني', 'مأكولات', 'الأطعمة', 'حرارة الأطعمة', 'batteur', 'blander', 'jus portable', 'broyeur', 'tasse', 'أكواب']],
  ['المنزل والتنظيم', ['rangement', 'تنظيم', 'organisateur', 'organis', 'étagère', 'رفوف', 'وحدة رفوف', 'panier', 'سلة', 'salle de bain', 'حمام', 'lampe', 'مصباح', 'anti-moustique', 'anti-moustiques', 'ناموس', 'camping', 'تخييم', 'matelas', 'فرشة', 'voiture', 'سيارة', 'coffre', 'porte-manteau', 'علاقة ملابس', 'قفل باب', 'gants de protection', 'dessous de plat', 'sécurité', 'boîte', 'علبة', 'brosse', 'فرشاة']]
];
function categorize(name) {
  const n = String(name || '').toLowerCase();
  for (const [cat, keys] of CATEGORY_RULES) {
    for (const k of keys) if (n.includes(k.toLowerCase())) return cat;
  }
  return 'عام';
}
module.exports = { CATEGORY_RULES, categorize };
