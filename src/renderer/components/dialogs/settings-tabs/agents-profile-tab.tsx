import { useState, useEffect, useCallback, useRef } from "react"
import { useAtomValue, useSetAtom } from "jotai"
import { Cloud } from "lucide-react"
import { Input } from "../../ui/input"
import { Label } from "../../ui/label"
import { IconSpinner } from "../../../icons"
import { toast } from "sonner"
import { localModeAtom, billingMethodAtom } from "../../../lib/atoms"
import { Button } from "../../ui/button"

// Hook to detect narrow screen
function useIsNarrowScreen(): boolean {
  const [isNarrow, setIsNarrow] = useState(false)

  useEffect(() => {
    const checkWidth = () => {
      setIsNarrow(window.innerWidth <= 768)
    }

    checkWidth()
    window.addEventListener("resize", checkWidth)
    return () => window.removeEventListener("resize", checkWidth)
  }, [])

  return isNarrow
}

interface DesktopUser {
  id: string
  email: string
  name: string | null
  imageUrl: string | null
  username: string | null
}

export function AgentsProfileTab() {
  const [user, setUser] = useState<DesktopUser | null>(null)
  const [fullName, setFullName] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const [isConnecting, setIsConnecting] = useState(false)
  const isNarrowScreen = useIsNarrowScreen()
  const savedNameRef = useRef("")
  const localMode = useAtomValue(localModeAtom)
  const setLocalMode = useSetAtom(localModeAtom)
  const setBillingMethod = useSetAtom(billingMethodAtom)

  // Fetch real user data from desktop API
  useEffect(() => {
    async function fetchUser() {
      if (window.desktopApi?.getUser) {
        const userData = await window.desktopApi.getUser()
        setUser(userData)
        setFullName(userData?.name || "")
        savedNameRef.current = userData?.name || ""
      }
      setIsLoading(false)
    }
    fetchUser()
  }, [])

  const handleBlurSave = useCallback(async () => {
    const trimmed = fullName.trim()
    if (trimmed === savedNameRef.current) return
    try {
      if (window.desktopApi?.updateUser) {
        const updatedUser = await window.desktopApi.updateUser({ name: trimmed })
        if (updatedUser) {
          setUser(updatedUser)
          savedNameRef.current = updatedUser.name || ""
          setFullName(updatedUser.name || "")
        }
      }
    } catch (error) {
      console.error("Error updating profile:", error)
      toast.error(
        error instanceof Error ? error.message : "Failed to update profile"
      )
    }
  }, [fullName])

  const handleConnectAccount = async () => {
    setIsConnecting(true)
    try {
      // Start auth flow
      await window.desktopApi?.startAuthFlow()
      // The auth success event will be handled by App.tsx
      // After auth, we'll disable local mode
    } catch (error) {
      console.error("Error starting auth flow:", error)
      toast.error(
        error instanceof Error ? error.message : "Failed to start authentication"
      )
      setIsConnecting(false)
    }
  }

  // Listen for auth success to disable local mode
  useEffect(() => {
    if (!localMode) return

    const unsubscribe = window.desktopApi?.onAuthSuccess((authenticatedUser) => {
      if (authenticatedUser) {
        setUser(authenticatedUser)
        setFullName(authenticatedUser.name || "")
        savedNameRef.current = authenticatedUser.name || ""
        setLocalMode(false)
        setBillingMethod("claude-subscription") // Default to Claude subscription after connecting
        setIsConnecting(false)
        toast.success("Account connected successfully!")
      }
    })

    return () => {
      if (unsubscribe) unsubscribe()
    }
  }, [localMode, setLocalMode, setBillingMethod])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <IconSpinner className="h-6 w-6" />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      {/* Profile Settings Card */}
      <div className="space-y-2">
        {/* Header - hidden on narrow screens since it's in the navigation bar */}
        {!isNarrowScreen && (
          <div className="flex items-center justify-between pb-3 mb-4">
            <h3 className="text-sm font-medium text-foreground">Account</h3>
          </div>
        )}

        {/* Local Mode - Show Connect Account option */}
        {localMode ? (
          <div className="bg-background rounded-lg border border-border overflow-hidden">
            <div className="p-6 text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto">
                <Cloud className="w-6 h-6 text-muted-foreground" />
              </div>
              <div className="space-y-2">
                <h4 className="text-sm font-medium">Using Local Mode</h4>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                  You're using the app without a 21st.dev account. Connect to enable team features,
                  chat sync across devices, and automations.
                </p>
              </div>
              <Button
                onClick={handleConnectAccount}
                disabled={isConnecting}
                className="min-w-[120px]"
              >
                {isConnecting ? (
                  <>
                    <IconSpinner className="h-4 w-4 mr-2" />
                    Connecting...
                  </>
                ) : (
                  "Connect Account"
                )}
              </Button>
            </div>
          </div>
        ) : (
          /* Connected account - show profile fields */
          <div className="bg-background rounded-lg border border-border overflow-hidden">
            {/* Full Name Field */}
            <div className="flex items-center justify-between p-4">
              <div className="flex-1">
                <Label className="text-sm font-medium">Full Name</Label>
                <p className="text-sm text-muted-foreground">
                  This is your display name
                </p>
              </div>
              <div className="flex-shrink-0 w-80">
                <Input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  onBlur={handleBlurSave}
                  className="w-full"
                  placeholder="Enter your name"
                />
              </div>
            </div>

            {/* Email Field (read-only) */}
            <div className="flex items-center justify-between p-4 border-t border-border">
              <div className="flex-1">
                <Label className="text-sm font-medium">Email</Label>
                <p className="text-sm text-muted-foreground">
                  Your account email
                </p>
              </div>
              <div className="flex-shrink-0 w-80">
                <Input
                  value={user?.email || ""}
                  disabled
                  className="w-full opacity-60"
                />
              </div>
            </div>

          </div>
        )}
      </div>

    </div>
  )
}
