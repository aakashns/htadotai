type WhatsAppMetadata = {
  display_phone_number: string;
  phone_number_id: string;
};

type WhatsAppContact = {
  profile: {
    name: string;
  };
  wa_id: string;
};

type WhatsAppMessage = {
  from: string;
  id: string;
  timestamp: number;
  text: {
    body: string;
  };
  type: string;
};

type WhatsAppWebhookChangeValue = {
  messaging_product: "whatsapp";
  metadata: WhatsAppMetadata;
  contacts: WhatsAppContact[];
  messages: WhatsAppMessage[];
};

export type WhatsAppWebhookBody = {
  object: "whatsapp_business_account";
  entry?: {
    id: string; // WhatsApp Business Account ID
    changes?: {
      value: WhatsAppWebhookChangeValue;
      field: "messages";
    }[];
  }[];
};

