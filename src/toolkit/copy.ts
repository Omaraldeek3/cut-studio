export type Language='en'|'ar';
export const toolIds=['trace','upscale','lettering','contour','clean','repeat','nest','box','polybox','hinge','tag','trophy','pattern','engrave','testcard','kerf','cnc','feeds','tiles','sheet','quote','gear','puzzle','ruler','dpi'] as const;
export type ToolId=typeof toolIds[number];
/** The tools grouped the way a workshop thinks about them, in toolIds order. */
export const groups:{id:string;title:[string,string];tools:ToolId[]}[]=[
  {id:'artwork',title:['Artwork','التصميم'],tools:['trace','upscale','lettering','contour','clean','repeat']},
  {id:'laser',title:['Laser & CNC','الليزر والقص'],tools:['nest','box','polybox','hinge','tag','trophy','pattern','engrave','testcard','kerf','cnc','feeds']},
  {id:'print',title:['Print','الطباعة'],tools:['tiles','sheet']},
  {id:'business',title:['Business','الأعمال'],tools:['quote']},
  // Occasional makers and calculators; engraving prep and the upscaler already set DPI themselves.
  {id:'extras',title:['More tools','أدوات إضافية'],tools:['gear','puzzle','ruler','dpi']},
];
export const groupOf=(id:ToolId)=>groups.find(g=>g.tools.includes(id))!;

/** Each tool's address. English words in both languages, so a link stays
 *  readable when it is copied into a chat or a search result. */
export const slugs:Record<ToolId,string>={
  trace:'image-to-vector',upscale:'ai-image-upscaler',lettering:'arabic-lettering',contour:'contour-offset',clean:'vector-cleanup',repeat:'resize-repeat',
  nest:'nesting',box:'box-maker',gear:'gear-maker',hinge:'living-hinge',puzzle:'jigsaw-puzzle',tag:'keychains-tags',pattern:'grille-patterns',
  engrave:'engraving-prep',testcard:'laser-test-card',kerf:'kerf-fit-test',trophy:'trophy-base',polybox:'polygon-box',cnc:'cnc-prep',feeds:'cnc-feeds-speeds',ruler:'ruler-maker',tiles:'poster-tiling',sheet:'print-sheet',dpi:'dpi-calculator',quote:'job-quote',
};
export const toolFromSlug=(slug:string)=>toolIds.find(id=>slugs[id]===slug);
/** The tool a bare locale address opens. */
export const defaultTool:ToolId='trace';

/** Titles for search results: what someone would type to find the tool. */
export const seoTitles:Record<ToolId,[string,string]>={
  trace:['Image to vector: trace logos and pictures to SVG and DXF','تحويل الصور إلى فيكتور SVG و DXF'],
  upscale:['AI image upscaler for large-format print','تكبير الصور بالذكاء الاصطناعي للطباعة الكبيرة'],
  lettering:['Arabic lettering to cut paths for laser and vinyl','تحويل الكتابة العربية إلى مسارات قص للّيزر والفينيل'],
  contour:['Contour and offset for letters, logos and stickers','كونتور وإزاحة للحروف والشعارات والستيكرات'],
  clean:['Repair SVG and DXF for cutting: delete overlap, join gaps','إصلاح ملفات SVG و DXF للقص: حذف التداخل وربط الفجوات'],
  repeat:['Resize and repeat artwork in millimetres','تغيير المقاس وتكرار التصميم بالملليمتر'],
  nest:['Free nesting for laser cutting and CNC','ترتيب القطع للقص بالليزر والـCNC مجاناً'],
  box:['Laser box maker with finger joints, lids and drawers','صانع صناديق الليزر بالتعشيق والأغطية والأدراج'],
  gear:['Gear maker: involute spur gears and meshing pairs','صانع التروس: تروس إنفوليوت وأزواج متعشّقة'],
  hinge:['Living hinge generator for plywood and MDF','مولّد المفصل المرن للخشب والـMDF'],
  puzzle:['Jigsaw puzzle generator for laser cutting','مولّد البازل للقص بالليزر'],
  tag:['Keychain and tag maker with Arabic text','صانع الميداليات والبطاقات بالنص العربي'],
  pattern:['Grille and ventilation pattern generator','مولّد نقوش التهوية والشبكات'],
  engrave:['Photo engraving prep with dithering for CO2 and fibre','تجهيز الصور للحفر بالليزر مع التنقيط'],
  testcard:['Laser power and speed test card','بطاقة اختبار القوة والسرعة لليزر'],
  kerf:['Kerf and fit test coupon for laser cutting','عينة اختبار التعشيق والكيرف للقص بالليزر'],
  polybox:['Hexagon and polygon box maker with a living-hinge wall','صانع الصناديق السداسية والمضلعة بجدار مفصل مرن'],
  trophy:['Trophy and award base maker with a slot for an acrylic plate','صانع قواعد الدروع والجوائز بمجرى للوح الأكريليك'],
  feeds:['CNC feeds and speeds calculator for router bits','حاسبة سرعة الدوران والتغذية لريش راوتر CNC'],
  cnc:['CNC prep: dogbones, bit checks and holding tabs for any design','تجهيز ملفات CNC: تفريغ الزوايا وفحص الريشة وجسور التثبيت لأي تصميم'],
  ruler:['Ruler maker for laser engraving','صانع المساطر للحفر بالليزر'],
  tiles:['Poster tiling: split a large print into panels','تقسيم البوستر إلى ألواح للطباعة الكبيرة'],
  sheet:['Print sheet for stickers, labels and sublimation','ورقة طباعة للستيكرات والملصقات والسابليميشن'],
  dpi:['DPI calculator for engraving and print','حاسبة الدقة DPI للحفر والطباعة'],
  quote:['Laser and print job quote calculator','حاسبة عرض سعر لأعمال الليزر والطباعة'],
};
export const titles:Record<ToolId,[string,string]>={polybox:['Polygon box','صندوق مضلع'],trophy:['Trophy base','قاعدة الدروع'],cnc:['CNC prep','تجهيز CNC'],feeds:['Feeds & speeds','السرعات والتغذية'],nest:['Material nesting','ترتيب القطع'],trace:['Image to vector','تحويل صورة إلى فيكتور'],clean:['Vector cleanup','تنظيف الفيكتور'],repeat:['Resize & repeat','المقاس والتكرار'],quote:['Job quote','عرض السعر'],kerf:['Fit test','اختبار التعشيق'],engrave:['Engraving prep','تجهيز صور الحفر'],box:['Box maker','صانع الصناديق'],
  upscale:['AI upscaler','تكبير الصور بالذكاء الاصطناعي'],tiles:['Poster tiling','تقسيم البوستر'],contour:['Contour & offset','الكونتور والإزاحة'],lettering:['Arabic lettering','الكتابة العربية'],sheet:['Print sheet','ورقة الطباعة'],
  hinge:['Living hinge','المفصل المرن'],gear:['Gear maker','صانع التروس'],puzzle:['Jigsaw puzzle','صانع البازل'],tag:['Tags & keychains','الميداليات والبطاقات'],pattern:['Grille patterns','نقوش التهوية'],testcard:['Power & speed test','بطاقة اختبار القوة والسرعة'],ruler:['Ruler maker','صانع المساطر'],dpi:['Resolution & DPI','الدقة والـDPI']};
export const descriptions:Record<ToolId,[string,string]>={
  nest:['A better fit for every piece. Arrange your outlines and make the most of your material.','رتّب حدود القطع للاستفادة من مساحة الخامة وتقليل الهدر.'],
  trace:['Trace logos, cartoons and photos into smooth colour vectors for print, or into clean outlines for the laser and plotter.','حوّل الشعارات والرسومات والصور إلى فيكتور ملوّن بمنحنيات ناعمة للطباعة، أو إلى حدود نظيفة للّيزر والبلوتر.'],
  clean:['Repair a file for cutting: remove overlapping lines, join small gaps and cut the nodes down to clean lines and arcs.','أصلح الملف للقص: احذف الخطوط المتداخلة، واربط الفجوات الصغيرة، وحوّل النقاط الكثيرة إلى خطوط وأقواس نظيفة.'],
  repeat:['One design, exactly the size you need. Scale and repeat with precise spacing.','اضبط أبعاد التصميم وكرّره بمسافات دقيقة.'],
  quote:['Price a job from its material, machine time, labour and margin, and send the customer a quote.','سعّر العمل من الخامة ووقت الماكينة والأجرة والربح، وأرسل للزبون عرض السعر.'],
  polybox:['A hexagon, octagon or any 5 to 12 sided box: one wall strip that bends round the corners, a base with slots and a lift-off lid.','صندوق سداسي أو ثماني أو بأي عدد من ٥ إلى ١٢ ضلعاً: شريط جدار واحد ينثني حول الزوايا، وقاعدة بفتحات، وغطاء يُرفع.'],
  trophy:['A stacked base with a slot sized to your acrylic, and the plate itself, arched or square.','قاعدة من طبقات بمجرى بمقاس الأكريليك، واللوح نفسه بقوس أو مستطيل.'],
  feeds:['Spindle speed, feed, plunge and depth per pass for your bit, material and machine.','سرعة الدوران والتغذية والنزول وعمق كل مرور لريشتك وخامتك وماكينتك.'],
  cnc:['Get any design ready for a CNC router: dogbones in inside corners, holes too narrow for the bit, and holding tabs.','جهّز أي تصميم لراوتر CNC: تفريغ الزوايا الداخلية، وكشف الثقوب الأضيق من الريشة، وجسور التثبيت.'],
  kerf:['Find the fit that feels right. Generate a slotted coupon for your material.','أنشئ عينة بفتحات مختلفة لاختيار المقاس الأنسب لتعشيق الخامة.'],
  engrave:['Prepare photos for CO2 and fibre engraving at the real line resolution, with material presets and eight dithering methods.','جهّز الصور للحفر بليزر CO2 والفايبر بدقة الأسطر الحقيقية، مع إعدادات جاهزة للخامات وثماني طرق تنقيط.'],
  box:['Design a finger-joint box to your size and material, ready to cut.','صمّم صندوقاً بتعشيق الأسنان بمقاسك وسماكة خامتك، جاهزاً للقص.'],
  upscale:['Enlarge a picture up to 8×: an AI model adds believable detail up to 4×, and a smooth enlargement takes it further. Save it with the right DPI for a large print.','كبّر الصورة حتى ٨ أضعاف: نموذج ذكاء اصطناعي يضيف تفاصيل مقنعة حتى ٤ أضعاف، ثم يكمل تكبير ناعم ما بعدها. واحفظها بالدقة المناسبة للطباعة الكبيرة.'],
  tiles:['Split a large print into panels your printer can take, with overlap, numbers and marks for fitting.','قسّم الطباعة الكبيرة إلى ألواح بعرض طابعتك، مع تداخل وأرقام وعلامات للتركيب.'],
  contour:['Add an outline around letters, logos or stickers: a base for acrylic letters, or a cut line for print and cut.','أضف حداً حول الحروف والشعارات والستيكرات: قاعدة للحروف البارزة أو خط قص للطباعة والقص.'],
  lettering:['Type Arabic or English in any font on your computer and get joined, weldable outlines ready to cut.','اكتب بالعربية أو الإنجليزية بأي خط على جهازك واحصل على حدود متصلة جاهزة للقص.'],
  sheet:['Repeat a design across A4, A3 or a roll for stickers, labels and sublimation, with bleed, marks and cut lines.','كرّر التصميم على ورقة A4 أو A3 أو رول للستيكرات والملصقات والسابليميشن، مع زيادة طباعة وعلامات وخطوط قص.'],
  hinge:['Cut a flexing pattern into flat plywood or MDF so it bends around a curve.','اقطع نقشاً مرناً في لوح الخشب أو الـMDF ليلتف حول الانحناءات.'],
  gear:['Draw a true involute spur gear from its tooth count and module, with a bore.','ارسم ترساً بأسنان إنفوليوت حقيقية من عدد الأسنان والموديول، مع فتحة المحور.'],
  puzzle:['Generate a jigsaw with round tabs, a new shuffle each time you ask.','أنشئ بازلاً بألسنة دائرية، وترتيباً جديداً كلما طلبت.'],
  tag:['Keychains, gift tags and labels in five shapes, with a hole and engraved text.','ميداليات وبطاقات هدايا بخمسة أشكال، مع ثقب ونص محفور.'],
  pattern:['Fill a panel with hexagon, circle, diamond or slot holes for grilles and lamps.','املأ لوحاً بفتحات سداسية أو دائرية أو معيّنة أو طولية للتهوية والإضاءة.'],
  testcard:['Engrave a grid of squares across power and speed to find your material settings.','احفر شبكة مربعات بقيم قوة وسرعة مختلفة لتعرف إعدادات خامتك.'],
  ruler:['A ruler in millimetres or inches, with engraved ticks and numbers.','مسطرة بالملليمتر أو الإنش، بتدريجات وأرقام محفورة.'],
  dpi:['Convert between millimetres, pixels and DPI, and find the line interval to engrave at.','حوّل بين الملليمتر والبكسل والـDPI، واعرف تباعد الأسطر المناسب للحفر.']};
export const tx=(lang:Language,en:string,ar:string)=>lang==='ar'?ar:en;
