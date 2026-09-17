export type Language='en'|'ar';
export const toolIds=['nest','trace','clean','repeat','cost','kerf','engrave','box'] as const;
export type ToolId=typeof toolIds[number];
export const titles:Record<ToolId,[string,string]>={nest:['Material nesting','ترتيب القطع'],trace:['Image to vector','تحويل صورة إلى فيكتور'],clean:['Vector cleanup','تنظيف الفيكتور'],repeat:['Resize & repeat','المقاس والتكرار'],cost:['Material cost','تكلفة الخامة'],kerf:['Fit test','اختبار التعشيق'],engrave:['Engraving prep','تجهيز صور الحفر'],box:['Box maker','صانع الصناديق']};
export const descriptions:Record<ToolId,[string,string]>={
  nest:['A better fit for every piece. Arrange your outlines and make the most of your material.','رتّب حدود القطع للاستفادة من مساحة الخامة وتقليل الهدر.'],
  trace:['Turn your logos and silhouettes into clean, editable vector paths.','حوّل الشعارات والرسومات أحادية اللون إلى مسارات قابلة للتعديل.'],
  clean:['Inspect open paths, remove duplicate contours, and clear away tiny details.','افحص المسارات المفتوحة وأزل الحدود المكررة والتفاصيل الصغيرة.'],
  repeat:['One design, exactly the size you need. Scale and repeat with precise spacing.','اضبط أبعاد التصميم وكرّره بمسافات دقيقة.'],
  cost:['Know your material cost before the first cut. Use your own prices and quantities.','احسب تكلفة الخامة قبل القص باستخدام أسعارك وكمياتك.'],
  kerf:['Find the fit that feels right. Generate a slotted coupon for your material.','أنشئ عينة بفتحات مختلفة لاختيار المقاس الأنسب لتعشيق الخامة.'],
  engrave:['Prepare crisp, black-and-white images for your engraving workflow.','جهّز صوراً بالأبيض والأسود لتناسب أعمال الحفر.'],
  box:['Design a finger-joint box to your size and material, ready to cut.','صمّم صندوقاً بتعشيق الأسنان بمقاسك وسماكة خامتك، جاهزاً للقص.']};
export const tx=(lang:Language,en:string,ar:string)=>lang==='ar'?ar:en;
