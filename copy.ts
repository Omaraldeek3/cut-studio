export type Language='en'|'ar';
export const toolIds=['nest','trace','upscale','tiles','contour','lettering','sheet','clean','repeat','cost','kerf','engrave','box','hinge','gear','puzzle','tag','pattern','testcard','ruler','sign','jobtime','dpi'] as const;
export type ToolId=typeof toolIds[number];
export const titles:Record<ToolId,[string,string]>={nest:['Material nesting','ترتيب القطع'],trace:['Image to vector','تحويل صورة إلى فيكتور'],clean:['Vector cleanup','تنظيف الفيكتور'],repeat:['Resize & repeat','المقاس والتكرار'],cost:['Material cost','تكلفة الخامة'],kerf:['Fit test','اختبار التعشيق'],engrave:['Engraving prep','تجهيز صور الحفر'],box:['Box maker','صانع الصناديق'],
  upscale:['AI upscaler','تكبير الصور بالذكاء الاصطناعي'],tiles:['Poster tiling','تقسيم البوستر'],contour:['Contour & offset','الكونتور والإزاحة'],lettering:['Arabic lettering','الكتابة العربية'],sheet:['Print sheet','ورقة الطباعة'],
  hinge:['Living hinge','المفصل المرن'],gear:['Gear maker','صانع التروس'],puzzle:['Jigsaw puzzle','صانع البازل'],tag:['Tags & keychains','الميداليات والبطاقات'],pattern:['Grille patterns','نقوش التهوية'],testcard:['Power & speed test','بطاقة اختبار القوة والسرعة'],ruler:['Ruler maker','صانع المساطر'],sign:['Sign & name plate','اللافتات ولوحات الأسماء'],jobtime:['Job time estimate','تقدير زمن القص'],dpi:['Resolution & DPI','الدقة والـDPI']};
export const descriptions:Record<ToolId,[string,string]>={
  nest:['A better fit for every piece. Arrange your outlines and make the most of your material.','رتّب حدود القطع للاستفادة من مساحة الخامة وتقليل الهدر.'],
  trace:['Trace logos, cartoons and photos into smooth colour vectors for print, or into clean outlines for the laser and plotter.','حوّل الشعارات والرسومات والصور إلى فيكتور ملوّن بمنحنيات ناعمة للطباعة، أو إلى حدود نظيفة للّيزر والبلوتر.'],
  clean:['Inspect open paths, remove duplicate contours, and clear away tiny details.','افحص المسارات المفتوحة وأزل الحدود المكررة والتفاصيل الصغيرة.'],
  repeat:['One design, exactly the size you need. Scale and repeat with precise spacing.','اضبط أبعاد التصميم وكرّره بمسافات دقيقة.'],
  cost:['Know your material cost before the first cut. Use your own prices and quantities.','احسب تكلفة الخامة قبل القص باستخدام أسعارك وكمياتك.'],
  kerf:['Find the fit that feels right. Generate a slotted coupon for your material.','أنشئ عينة بفتحات مختلفة لاختيار المقاس الأنسب لتعشيق الخامة.'],
  engrave:['Prepare photos for CO2 and fibre engraving at the real line resolution, with material presets and eight dithering methods.','جهّز الصور للحفر بليزر CO2 والفايبر بدقة الأسطر الحقيقية، مع إعدادات جاهزة للخامات وثماني طرق تنقيط.'],
  box:['Design a finger-joint box to your size and material, ready to cut.','صمّم صندوقاً بتعشيق الأسنان بمقاسك وسماكة خامتك، جاهزاً للقص.'],
  upscale:['Enlarge a picture up to 4× with an AI model that draws in real detail, and save it with the right DPI for a large print.','كبّر الصورة حتى ٤ أضعاف بنموذج ذكاء اصطناعي يرسم تفاصيل حقيقية، واحفظها بالدقة المناسبة للطباعة الكبيرة.'],
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
  sign:['Door signs and name plates with engraved lettering, a border and mounting holes.','لافتات أبواب ولوحات أسماء بحروف محفورة وإطار وثقوب تثبيت.'],
  jobtime:['Estimate how long a file takes on the laser, and what that machine time costs.','قدّر كم يستغرق الملف على الليزر، وكم تكلّف ساعات الماكينة.'],
  dpi:['Convert between millimetres, pixels and DPI, and find the line interval to engrave at.','حوّل بين الملليمتر والبكسل والـDPI، واعرف تباعد الأسطر المناسب للحفر.']};
export const tx=(lang:Language,en:string,ar:string)=>lang==='ar'?ar:en;
