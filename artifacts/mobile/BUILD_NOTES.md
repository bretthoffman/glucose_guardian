# You need this when you change anything that affects the native app binary, like:
#	•	Expo/native dependencies
#	•	iOS permissions/capabilities
#	•	app config
#	•	Expo SDK version
#	•	anything that requires a new binary

# make a new iOS build:
# eas build --platform ios --profile production

# after it succeeds
# eas submit --platform ios --profile production




# You can use this for non-native changes, like:
#	•	JavaScript logic
#	•	UI text/layout/styling
#	•	images/assets
#	•	many bug fixes

# Expo says EAS Update can ship JS, styling, and images over the air, and users get the 
# new version on their next app launch without reinstalling.  

# before using it for the first time, run this
# eas update:configure

# Over-the-air update command
# eas update --channel production --message "your update message" --environment production





# confirm the vars exist
# eas env:list --environment production

# set new env vars
# eas env:create --name EXPO_PUBLIC_CONVEX_URL --value https://YOUR-CONVEX-DEPLOYMENT.convex.cloud --environment production --visibility plaintext

# expo doctor
# npx expo-doctor


# reviewer Apple sign-in
# USER: reviewer@glucoseguardian.app
# PASS: Test1234!