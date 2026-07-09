# Keep kotlinx.serialization models
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt
-keepclassmembers class kotlinx.serialization.json.** {
    *** Companion;
}
-keepclasseswithmembers class com.copytrade.app.data.remote.dto.**$$serializer {
    *** serializer(...);
}
-keepclassmembers class com.copytrade.app.data.remote.dto.** {
    *** Companion;
}
-keep,includedescriptorclasses class com.copytrade.app.data.remote.dto.**$$serializer { *; }
