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

# Tink (pulled in by androidx.security-crypto) references error-prone annotations
# that are compile-time only and not present at runtime; R8 must not fail on them.
-dontwarn com.google.errorprone.annotations.**
